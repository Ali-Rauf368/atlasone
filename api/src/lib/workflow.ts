import type { Role } from "./rbac.js";

export interface StepDef { role: Role; label: string; slaHours: number; budgetCheck?: boolean }
export interface Rule { name: string; minAmountUsd: number; maxAmountUsd: number | null; steps: StepDef[] }

/** Default approval matrix. Seeded into WorkflowRule and editable at runtime via /api/workflow/rules. */
export const DEFAULT_RULES: Rule[] = [
  { name: "Low value (< $5k)", minAmountUsd: 0, maxAmountUsd: 5_000,
    steps: [{ role: "FINANCE", label: "Finance budget validation", slaHours: 24, budgetCheck: true }] },
  { name: "Standard ($5k – $100k)", minAmountUsd: 5_000, maxAmountUsd: 100_000,
    steps: [{ role: "REGIONAL_DIRECTOR", label: "Regional director approval", slaHours: 48 },
            { role: "FINANCE", label: "Finance budget validation", slaHours: 24, budgetCheck: true }] },
  { name: "Strategic (≥ $100k)", minAmountUsd: 100_000, maxAmountUsd: null,
    steps: [{ role: "REGIONAL_DIRECTOR", label: "Regional director approval", slaHours: 48 },
            { role: "FINANCE", label: "Finance budget validation", slaHours: 24, budgetCheck: true },
            { role: "GLOBAL_CEO", label: "CEO sign-off (major decision)", slaHours: 72 }] },
];

/** Most specific (highest minimum) rule whose [min, max) band contains the amount. */
export function pickRule(rules: Rule[], amountUsd: number): Rule {
  const r = rules.filter((x) => amountUsd >= x.minAmountUsd && (x.maxAmountUsd == null || amountUsd < x.maxAmountUsd))
    .sort((a, b) => b.minAmountUsd - a.minAmountUsd)[0];
  if (!r) throw Object.assign(new Error(`No approval rule covers $${amountUsd}`), { status: 422 });
  return r;
}

export type PoStatus = "PENDING_APPROVAL" | "APPROVED" | "SENT_TO_SUPPLIER" | "REJECTED";

export function checkApprover(po: { status: PoStatus; createdBy: string }, step: { role: string } | undefined, user: { uid: string; roles: Role[] }):
  { ok: true } | { ok: false; code: 403 | 409; error: string } {
  if (po.status !== "PENDING_APPROVAL" || !step) return { ok: false, code: 409, error: `PO is ${po.status}` };
  if (!user.roles.includes(step.role as Role)) return { ok: false, code: 403, error: `This step requires ${step.role}` };
  if (po.createdBy === user.uid) return { ok: false, code: 403, error: "Segregation of duties: cannot approve own PO" };
  return { ok: true };
}

export function checkBudget(budgetUsd: number, spentUsd: number, amountUsd: number) {
  const remaining = budgetUsd - spentUsd;
  return amountUsd <= remaining ? { ok: true as const, remaining } : { ok: false as const, remaining, error: `Budget exceeded: remaining $${remaining.toFixed(2)}` };
}

/** Validates rule sets edited by admins: bands must not overlap and must start at 0. */
export function validateRules(rules: Rule[]): string | null {
  const sorted = [...rules].sort((a, b) => a.minAmountUsd - b.minAmountUsd);
  if (!sorted.length || sorted[0].minAmountUsd !== 0) return "Rules must start at $0";
  for (let i = 0; i < sorted.length; i++) {
    const r = sorted[i], next = sorted[i + 1];
    if (!r.steps.length) return `${r.name}: needs at least one step`;
    if (!r.steps.some((s) => s.budgetCheck)) return `${r.name}: needs a budget-check step`;
    if (next && r.maxAmountUsd !== next.minAmountUsd) return `Gap or overlap between "${r.name}" and "${next.name}"`;
    if (!next && r.maxAmountUsd !== null) return `Last rule "${r.name}" must be open-ended`;
  }
  return null;
}
