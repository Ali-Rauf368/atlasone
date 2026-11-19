import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requirePerm } from "../middleware/auth.js";
import { validateRules, type Rule } from "../lib/workflow.js";
import { ROLES } from "../lib/rbac.js";
import { audit } from "../models/audit.js";
import { Notification, inboxFilter } from "../lib/notify.js";
import { loadRules } from "./purchaseOrders.js";

export const governanceRouter = Router();

// --- Workflow rules (approval matrix) ---
governanceRouter.get("/workflow/rules", async (_req, res) => res.json((await loadRules()).sort((a, b) => a.minAmountUsd - b.minAmountUsd)));

const RuleSchema = z.object({
  name: z.string().min(2), minAmountUsd: z.number().min(0), maxAmountUsd: z.number().positive().nullable(),
  steps: z.array(z.object({ role: z.enum(ROLES), label: z.string().min(2), slaHours: z.number().int().positive().max(720), budgetCheck: z.boolean().optional() })).min(1).max(8),
});

governanceRouter.put("/workflow/rules", requirePerm("workflow:manage"), async (req, res) => {
  const rules = z.array(RuleSchema).min(1).parse(req.body) as Rule[];
  const err = validateRules(rules);
  if (err) return res.status(422).json({ error: err });
  const before = await loadRules();
  // In-flight POs keep their already-created step snapshot; new rules apply to new POs.
  await prisma.$transaction([
    prisma.workflowRule.updateMany({ data: { active: false } }),
    ...rules.map((r) => prisma.workflowRule.upsert({ where: { name: r.name }, update: { ...r, steps: r.steps as never, active: true }, create: { ...r, steps: r.steps as never } })),
  ]);
  await audit(req.user!, "WORKFLOW_RULES_CHANGED", "WorkflowRule", "matrix", { before, after: rules });
  res.json(await loadRules());
});

// --- Notification inbox (persisted) ---
governanceRouter.get("/notifications", async (req, res) => {
  const u = req.user!;
  const rows = await Notification.find(inboxFilter(u.uid, u.roles)).sort({ at: -1 }).limit(50).lean();
  res.json(rows.map((n) => ({ id: String(n._id), title: n.title, body: n.body, link: n.link, at: n.at, read: n.readBy.includes(u.uid) })));
});
governanceRouter.post("/notifications/read-all", async (req, res) => {
  const u = req.user!;
  await Notification.updateMany(inboxFilter(u.uid, u.roles), { $addToSet: { readBy: u.uid } });
  res.json({ ok: true });
});

governanceRouter.get("/me", (req, res) => res.json(req.user));
