import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { toUsd } from "../lib/fx.js";
import { requirePerm } from "../middleware/auth.js";
import { companyFilter, inScope, scopeCompanyIds } from "../lib/scope.js";
import { audit } from "../models/audit.js";
import { invalidate } from "../lib/cache.js";

export const financeRouter = Router();

// --- FX rates (multi-currency) ---
financeRouter.get("/fx", requirePerm("org:read"), async (_req, res) =>
  res.json((await prisma.fxRate.findMany({ orderBy: { currency: "asc" } })).map((r) => ({ currency: r.currency, toUsd: Number(r.toUsd), updated: r.updated }))));

financeRouter.put("/fx/:currency", requirePerm("finance:manage"), async (req, res) => {
  const currency = z.string().length(3).toUpperCase().parse(req.params.currency);
  if (currency === "USD") return res.status(400).json({ error: "USD is the reporting currency" });
  const { toUsd: rate } = z.object({ toUsd: z.number().positive() }).parse(req.body);
  const before = await prisma.fxRate.findUnique({ where: { currency } });
  // Guard rail: changes over 20% need a second look; most likely a typo (e.g. inverted rate)
  if (before && Math.abs(rate / Number(before.toUsd) - 1) > 0.2 && req.query.confirm !== "true")
    return res.status(409).json({ error: `Rate moves ${((rate / Number(before.toUsd) - 1) * 100).toFixed(1)}%. Resend with ?confirm=true if intended.` });
  const r = await prisma.fxRate.upsert({ where: { currency }, update: { toUsd: rate }, create: { currency, toUsd: rate } });
  await audit(req.user!, "FX_RATE_CHANGED", "FxRate", currency, { from: before ? Number(before.toUsd) : null, to: rate });
  res.json(r);
});

// --- Journal entries ---
financeRouter.get("/entries", requirePerm("org:read"), async (req, res) => {
  const { companyId, period, source } = req.query as Record<string, string | undefined>;
  const scope = await scopeCompanyIds(req.user!);
  const rows = await prisma.financialEntry.findMany({
    where: { ...companyFilter(scope), ...(companyId && { companyId }), ...(period && { period }), ...(source && { source: { startsWith: source } }) },
    include: { company: { select: { name: true } } }, orderBy: [{ period: "desc" }, { id: "desc" }], take: 200 });
  res.json(rows.map((r) => ({ ...r, amount: Number(r.amount), amountUsd: Number(r.amountUsd) })));
});

financeRouter.post("/entries", requirePerm("finance:manage"), async (req, res) => {
  const d = z.object({ companyId: z.string(), period: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), type: z.enum(["REVENUE", "EXPENSE"]),
    category: z.string().min(2).max(120), amount: z.number().positive() }).parse(req.body);
  if (!inScope(await scopeCompanyIds(req.user!), d.companyId)) return res.status(403).json({ error: "Company outside your scope" });
  const company = await prisma.company.findUniqueOrThrow({ where: { id: d.companyId } });
  const e = await prisma.financialEntry.create({ data: { ...d, currency: company.currency, amountUsd: await toUsd(d.amount, company.currency), source: `manual:${req.user!.uid}` } });
  await audit(req.user!, "JOURNAL_ENTRY_POSTED", "FinancialEntry", e.id, { ...d, currency: company.currency });
  await invalidate("dashboard:global");
  res.status(201).json(e);
});

// --- Budgets & financial planning ---
financeRouter.put("/budgets/:companyId/:year", requirePerm("finance:manage"), async (req, res) => {
  const year = z.coerce.number().int().min(2000).max(2100).parse(req.params.year);
  const { amountUsd } = z.object({ amountUsd: z.number().min(0) }).parse(req.body);
  const before = await prisma.budget.findUnique({ where: { companyId_year: { companyId: req.params.companyId, year } } });
  if (before && amountUsd < Number(before.spentUsd)) return res.status(422).json({ error: `Below already committed spend ($${Number(before.spentUsd).toLocaleString()})` });
  const b = await prisma.budget.upsert({ where: { companyId_year: { companyId: req.params.companyId, year } }, update: { amountUsd }, create: { companyId: req.params.companyId, year, amountUsd } });
  await audit(req.user!, "BUDGET_SET", "Budget", b.id, { year, from: before ? Number(before.amountUsd) : null, to: amountUsd });
  res.json(b);
});
