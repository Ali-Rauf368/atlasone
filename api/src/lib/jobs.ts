import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { env } from "./env.js";
import { prisma } from "./db.js";
import { audit } from "../models/audit.js";
import { notifyRole } from "./notify.js";
import { detectAnomalies } from "./anomaly.js";

/**
 * Background jobs on BullMQ (Redis):
 *  - sla-check: delayed job per approval step; escalates to the CEO if the step is still open at its deadline
 *  - anomaly-scan: repeatable job (hourly) that flags unusual expense spikes per subsidiary
 * Without REDIS_URL, falls back to in-process timers so local dev still works.
 */
const SYSTEM = { uid: "system", name: "AtlasOne scheduler", roles: ["SYSTEM"] };
// BullMQ takes ioredis options or instances — a `{ url }` object is NOT a valid option and silently means localhost:6379.
// Workers need maxRetriesPerRequest: null (blocking commands).
const redisConn = () => new Redis(env.redisUrl!, { maxRetriesPerRequest: null });
const connection = env.redisUrl ? redisConn() : null;
connection?.on("error", (e) => console.warn("bullmq redis:", e.message));
const queue = connection ? new Queue("atlas", { connection }) : null;

export async function scheduleSlaCheck(stepId: string, dueAt: Date) {
  const delay = Math.max(0, dueAt.getTime() - Date.now());
  if (queue) {
    try { await queue.add("sla-check", { stepId }, { delay, jobId: slaJobId(stepId), removeOnComplete: true, attempts: 3, backoff: { type: "exponential", delay: 5000 } }); return; }
    // Scheduling must never fail the business action (creating/approving a PO); fall back to an in-process timer
    catch (e) { console.error("sla-check scheduling failed, using in-process timer:", (e as Error).message); }
  }
  setTimeout(() => slaCheck(stepId).catch(console.error), Math.min(delay, 2 ** 31 - 1)).unref();
}

/** BullMQ custom job ids must not contain ":" (and must not be integers). */
export const slaJobId = (stepId: string) => `sla-${stepId}`;

export async function slaCheck(stepId: string) {
  const step = await prisma.approvalStep.findUnique({ where: { id: stepId }, include: { po: true } });
  if (!step || step.decision || step.escalated || step.po.status !== "PENDING_APPROVAL" || step.po.currentStep !== step.index) return;
  await prisma.approvalStep.update({ where: { id: stepId }, data: { escalated: true } });
  await audit(SYSTEM, "PO_SLA_BREACHED", "PurchaseOrder", step.poId, { step: step.label, role: step.role, dueAt: step.dueAt });
  await notifyRole(step.role, { title: "Approval overdue", body: `${step.po.number}: "${step.label}" passed its SLA`, link: "/purchase-orders" });
  await notifyRole("GLOBAL_CEO", { title: "Escalation", body: `${step.po.number} is stuck at "${step.label}"`, link: "/purchase-orders" });
}

export async function anomalyScan() {
  const companies = await prisma.company.findMany({ select: { id: true, name: true } });
  const found: { company: string; period: string; zScore: number }[] = [];
  for (const c of companies) {
    const rows = await prisma.financialEntry.groupBy({ by: ["period"], where: { companyId: c.id, type: "EXPENSE" }, _sum: { amountUsd: true }, orderBy: { period: "asc" } });
    const latest = rows.at(-1)?.period;
    for (const a of detectAnomalies(rows.map((r) => ({ period: r.period, value: Number(r._sum.amountUsd ?? 0) }))))
      if (a.period === latest && a.direction === "spike") found.push({ company: c.name, period: a.period, zScore: a.zScore });
  }
  for (const f of found) await notifyRole("GLOBAL_CEO", { title: "Expense anomaly", body: `${f.company} ${f.period}: spend spike (z=${f.zScore})`, link: "/reports" });
  if (found.length) await audit(SYSTEM, "ANOMALIES_DETECTED", "FinancialEntry", "scan", found);
  return found;
}

export async function startJobs() {
  if (!queue || !connection) {
    setInterval(() => anomalyScan().catch(console.error), 3600_000).unref();
    return;
  }
  await queue.upsertJobScheduler("anomaly-scan", { every: 3600_000 }, { name: "anomaly-scan" });
  new Worker("atlas", async (job) => {
    if (job.name === "sla-check") return slaCheck(job.data.stepId);
    if (job.name === "anomaly-scan") return anomalyScan();
  }, { connection: redisConn(), concurrency: 5 }).on("failed", (j, e) => console.error(`job ${j?.name} failed:`, e.message));
}
