import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { toUsd } from "../lib/fx.js";
import { requirePerm } from "../middleware/auth.js";
import { checkApprover, checkBudget, pickRule, type Rule, type StepDef } from "../lib/workflow.js";
import { notifyRole, notifyUser } from "../lib/notify.js";
import { broadcast } from "../lib/realtime.js";
import { invalidate } from "../lib/cache.js";
import { scheduleSlaCheck } from "../lib/jobs.js";
import { companyFilter, inScope, scopeCompanyIds } from "../lib/scope.js";
import { audit } from "../models/audit.js";

export const poRouter = Router();

export async function loadRules(): Promise<Rule[]> {
  const rows = await prisma.workflowRule.findMany({ where: { active: true } });
  return rows.map((r) => ({ name: r.name, minAmountUsd: Number(r.minAmountUsd), maxAmountUsd: r.maxAmountUsd == null ? null : Number(r.maxAmountUsd), steps: r.steps as unknown as StepDef[] }));
}

const changed = async (id: string) => { broadcast("po:changed", { id }); await invalidate("dashboard:global"); };

poRouter.get("/", requirePerm("po:read"), async (req, res) => {
  const scope = await scopeCompanyIds(req.user!);
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  res.json(await prisma.purchaseOrder.findMany({
    where: { ...companyFilter(scope), ...(status && { status: status as never }) },
    include: { company: { select: { name: true, currency: true, region: true } }, steps: { orderBy: { index: "asc" } } },
    orderBy: { createdAt: "desc" }, take: 200,
  }));
});

/** Approvals waiting on the current user ("my inbox"). */
poRouter.get("/inbox", requirePerm("po:read"), async (req, res) => {
  const scope = await scopeCompanyIds(req.user!);
  const pos = await prisma.purchaseOrder.findMany({ where: { status: "PENDING_APPROVAL", ...companyFilter(scope), createdBy: { not: req.user!.uid } },
    include: { company: { select: { name: true } }, steps: { orderBy: { index: "asc" } } } });
  res.json(pos.filter((p) => req.user!.roles.includes(p.steps[p.currentStep]?.role as never)));
});

const CreatePo = z.object({ companyId: z.string(), supplier: z.string().min(2).max(200), description: z.string().min(3).max(2000), amount: z.number().positive().max(1e12) });

poRouter.post("/", requirePerm("po:create"), async (req, res) => {
  const data = CreatePo.parse(req.body);
  if (!inScope(await scopeCompanyIds(req.user!), data.companyId)) return res.status(403).json({ error: "Company outside your scope" });
  const company = await prisma.company.findUnique({ where: { id: data.companyId } });
  if (!company) return res.status(404).json({ error: "Company not found" });

  const amountUsd = await toUsd(data.amount, company.currency);
  const rule = pickRule(await loadRules(), amountUsd);
  const firstDue = new Date(Date.now() + rule.steps[0].slaHours * 3600_000);
  const po = await prisma.purchaseOrder.create({
    data: { ...data, currency: company.currency, amountUsd, ruleName: rule.name, createdBy: req.user!.uid,
      number: `PO-${Date.now().toString(36).toUpperCase()}`,
      steps: { create: rule.steps.map((s, index) => ({ index, role: s.role, label: s.label, dueAt: index === 0 ? firstDue : null })) } },
    include: { steps: { orderBy: { index: "asc" } } },
  });
  await scheduleSlaCheck(po.steps[0].id, firstDue);
  await audit(req.user!, "PO_CREATED", "PurchaseOrder", po.id, { number: po.number, amount: data.amount, currency: company.currency, amountUsd, rule: rule.name });
  await notifyRole(rule.steps[0].role, { title: "PO awaiting approval", body: `${po.number} · ${company.name} · ${data.amount.toLocaleString()} ${company.currency}`, link: "/purchase-orders" });
  await changed(po.id);
  res.status(201).json(po);
});

poRouter.post("/:id/decision", async (req, res) => {
  const { decision, comment } = z.object({ decision: z.enum(["APPROVE", "REJECT"]), comment: z.string().max(1000).optional() }).parse(req.body);
  const user = req.user!;
  const po = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id }, include: { steps: { orderBy: { index: "asc" } }, company: true } });
  if (!po || !inScope(await scopeCompanyIds(user), po.companyId)) return res.status(404).json({ error: "Not found" });
  if (decision === "REJECT" && !comment) return res.status(400).json({ error: "A comment is required when rejecting" });

  const step = po.steps[po.currentStep];
  const check = checkApprover(po, step, user);
  if (!check.ok) return res.status(check.code).json({ error: check.error });
  const stepDef = (await loadRules()).find((r) => r.name === po.ruleName)?.steps[po.currentStep];
  const isLast = po.currentStep === po.steps.length - 1;
  const now = new Date();

  try {
    const updated = await prisma.$transaction(async (tx) => {
      // Optimistic concurrency: only one approver can act on a given step
      const claimed = await tx.purchaseOrder.updateMany({ where: { id: po.id, currentStep: po.currentStep, status: "PENDING_APPROVAL" }, data: { updatedAt: now } });
      if (!claimed.count) throw Object.assign(new Error("This step was already decided"), { status: 409 });
      await tx.approvalStep.update({ where: { id: step.id }, data: { decision, decidedBy: user.uid, comment, decidedAt: now } });

      if (decision === "REJECT") return tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "REJECTED" } });

      if (stepDef?.budgetCheck) {
        const budget = await tx.budget.findUnique({ where: { companyId_year: { companyId: po.companyId, year: po.createdAt.getFullYear() } } });
        if (!budget) throw Object.assign(new Error("No budget defined for this company/year"), { status: 422 });
        const b = checkBudget(Number(budget.amountUsd), Number(budget.spentUsd), Number(po.amountUsd));
        if (!b.ok) throw Object.assign(new Error(b.error), { status: 422 });
        // Reserve the funds now so parallel POs cannot overspend the same budget
        await tx.budget.update({ where: { id: budget.id }, data: { spentUsd: { increment: po.amountUsd } } });
      }

      if (!isLast) {
        const next = po.steps[po.currentStep + 1];
        const nextDef = (await loadRules()).find((r) => r.name === po.ruleName)?.steps[po.currentStep + 1];
        await tx.approvalStep.update({ where: { id: next.id }, data: { dueAt: new Date(now.getTime() + (nextDef?.slaHours ?? 48) * 3600_000) } });
        return tx.purchaseOrder.update({ where: { id: po.id }, data: { currentStep: po.currentStep + 1 } });
      }

      await tx.financialEntry.create({ data: { companyId: po.companyId, period: now.toISOString().slice(0, 7), type: "EXPENSE",
        category: `Procurement: ${po.supplier}`, amount: po.amount, currency: po.currency, amountUsd: po.amountUsd, source: `po:${po.number}` } });
      await tx.shipment.create({ data: { tracking: `TRK-${po.number.slice(3)}`, poNumber: po.number, origin: po.supplier, destination: po.company.country, eta: new Date(now.getTime() + 14 * 864e5) } });
      return tx.purchaseOrder.update({ where: { id: po.id }, data: { status: "SENT_TO_SUPPLIER" } });
    });

    // If a budget was reserved earlier and the PO is now rejected, release it
    if (decision === "REJECT") {
      const reservedAt = (await loadRules()).find((r) => r.name === po.ruleName)?.steps.findIndex((s) => s.budgetCheck) ?? -1;
      if (reservedAt >= 0 && reservedAt < po.currentStep)
        await prisma.budget.update({ where: { companyId_year: { companyId: po.companyId, year: po.createdAt.getFullYear() } }, data: { spentUsd: { decrement: po.amountUsd } } });
      await audit(user, "PO_REJECTED", "PurchaseOrder", po.id, { step: step.label, comment });
      await notifyUser(po.createdBy, { title: "PO rejected", body: `${po.number}: ${comment}` });
    } else {
      await audit(user, "PO_STEP_APPROVED", "PurchaseOrder", po.id, { step: step.label, comment, budgetReserved: !!stepDef?.budgetCheck });
      if (!isLast) {
        const next = po.steps[po.currentStep + 1];
        const fresh = await prisma.approvalStep.findUniqueOrThrow({ where: { id: next.id } });
        if (fresh.dueAt) await scheduleSlaCheck(next.id, fresh.dueAt);
        await notifyRole(next.role, { title: "PO awaiting approval", body: `${po.number}: ${next.label}`, link: "/purchase-orders" });
        await notifyUser(po.createdBy, { title: "PO progressed", body: `${po.number}: ${step.label} ✓` });
      } else {
        await audit(user, "PO_SENT_TO_SUPPLIER", "PurchaseOrder", po.id, { supplier: po.supplier, amountUsd: Number(po.amountUsd) });
        await notifyUser(po.createdBy, { title: "PO sent to supplier", body: `${po.number} → ${po.supplier}` });
        await notifyRole("GLOBAL_CEO", { title: "Procurement committed", body: `${po.number}: $${Number(po.amountUsd).toLocaleString()}` });
      }
    }
    await changed(po.id);
    res.json(updated);
  } catch (e) {
    const err = e as Error & { status?: number };
    if (err.status === 422) await audit(user, "PO_BUDGET_CHECK_FAILED", "PurchaseOrder", po.id, { reason: err.message });
    throw err;
  }
});
