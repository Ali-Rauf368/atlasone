import { z } from "zod";
import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requirePerm } from "../middleware/auth.js";
import { linearForecast } from "../lib/forecast.js";
import { detectAnomalies } from "../lib/anomaly.js";
import { scopeCompanyIds, companyFilter } from "../lib/scope.js";

export const reportsRouter = Router();

// P&L per company for a period range, in USD; ?format=csv for export
reportsRouter.get("/pnl", requirePerm("org:read"), async (req, res) => {
  const from = String(req.query.from ?? "0000-00"), to = String(req.query.to ?? "9999-99");
  const rows = await prisma.financialEntry.groupBy({ by: ["companyId", "type"], where: { period: { gte: from, lte: to }, ...companyFilter(await scopeCompanyIds(req.user!)) }, _sum: { amountUsd: true } });
  const companies = await prisma.company.findMany({ select: { id: true, name: true, country: true } });
  const out = companies.map((c) => {
    const rev = Number(rows.find((r) => r.companyId === c.id && r.type === "REVENUE")?._sum.amountUsd ?? 0);
    const exp = Number(rows.find((r) => r.companyId === c.id && r.type === "EXPENSE")?._sum.amountUsd ?? 0);
    return { company: c.name, country: c.country, revenueUsd: rev, expensesUsd: exp, profitUsd: rev - exp };
  }).filter((r) => r.revenueUsd || r.expensesUsd);
  if (req.query.format === "csv") {
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    res.type("text/csv").attachment(`pnl_${from}_${to}.csv`)
      .send([Object.keys(out[0] ?? { company: "" }).join(","), ...out.map((r) => Object.values(r).map(esc).join(","))].join("\n"));
  } else res.json(out);
});

// Predictive analytics: least-squares revenue projection per company
reportsRouter.get("/forecast", requirePerm("dashboard:global"), async (req, res) => {
  const horizon = Math.min(12, Number(req.query.months ?? 3));
  const rows = await prisma.financialEntry.groupBy({ by: ["period"], where: { type: "REVENUE" }, _sum: { amountUsd: true }, orderBy: { period: "asc" } });
  const series = rows.map((r) => ({ period: r.period, value: Number(r._sum.amountUsd ?? 0) }));
  res.json({ history: series, forecast: linearForecast(series, horizon) });
});

reportsRouter.get("/budgets", requirePerm("org:read"), async (req, res) => {
  const b = await prisma.budget.findMany({ where: companyFilter(await scopeCompanyIds(req.user!)), include: { company: { select: { name: true } } } });
  res.json(b.map((x) => ({ companyId: x.companyId, company: x.company.name, year: x.year, budgetUsd: Number(x.amountUsd), spentUsd: Number(x.spentUsd), utilisation: Number(x.amountUsd) ? Number(x.spentUsd) / Number(x.amountUsd) : 0 })));
});

// Anomaly detection per subsidiary (median/MAD modified z-score) on monthly revenue and expenses
reportsRouter.get("/anomalies", requirePerm("org:read"), async (req, res) => {
  const scope = await scopeCompanyIds(req.user!);
  const threshold = Math.max(2, Math.min(6, Number(req.query.threshold ?? 3.5)));
  const companies = await prisma.company.findMany({ where: scope ? { id: { in: scope } } : {}, select: { id: true, name: true, country: true } });
  const rows = await prisma.financialEntry.groupBy({ by: ["companyId", "type", "period"], where: companyFilter(scope), _sum: { amountUsd: true }, orderBy: { period: "asc" } });
  res.json(companies.flatMap((c) => (["REVENUE", "EXPENSE"] as const).flatMap((type) =>
    detectAnomalies(rows.filter((r) => r.companyId === c.id && r.type === type).map((r) => ({ period: r.period, value: Number(r._sum.amountUsd ?? 0) })), threshold)
      .map((a) => ({ company: c.name, country: c.country, type, ...a })))).sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore)));
});

// --- Custom report builder: metric × dimension × period range, scoped, exportable ---
const Custom = z.object({
  metric: z.enum(["revenue", "expenses", "profit", "margin", "headcount", "po_spend", "pipeline", "won_deals"]),
  groupBy: z.enum(["company", "country", "region", "period"]),
  from: z.string().regex(/^\d{4}-\d{2}$/).default("0000-01"), to: z.string().regex(/^\d{4}-\d{2}$/).default("9999-12"),
  format: z.enum(["json", "csv"]).default("json"),
});

reportsRouter.post("/custom", requirePerm("org:read"), async (req, res) => {
  const q = Custom.parse(req.body);
  if (q.groupBy === "period" && ["headcount", "pipeline"].includes(q.metric)) return res.status(400).json({ error: `${q.metric} is a point-in-time metric; group by company, country or region` });
  const scope = await scopeCompanyIds(req.user!);
  const companies = await prisma.company.findMany({ where: scope ? { id: { in: scope } } : {}, select: { id: true, name: true, country: true, region: true } });
  const ids = companies.map((c) => c.id);
  const key = (companyId: string, period?: string) => {
    if (q.groupBy === "period") return period!;
    const c = companies.find((x) => x.id === companyId)!;
    return q.groupBy === "company" ? c.name : q.groupBy === "country" ? c.country : c.region;
  };
  const acc = new Map<string, { a: number; b: number }>();
  const add = (k: string, a: number, b = 0) => { const v = acc.get(k) ?? { a: 0, b: 0 }; v.a += a; v.b += b; acc.set(k, v); };

  if (["revenue", "expenses", "profit", "margin"].includes(q.metric)) {
    const rows = await prisma.financialEntry.groupBy({ by: ["companyId", "period", "type"], where: { companyId: { in: ids }, period: { gte: q.from, lte: q.to } }, _sum: { amountUsd: true } });
    for (const r of rows) { const v = Number(r._sum.amountUsd ?? 0); add(key(r.companyId, r.period), r.type === "REVENUE" ? v : 0, r.type === "EXPENSE" ? v : 0); }
  } else if (q.metric === "headcount") {
    for (const r of await prisma.employee.groupBy({ by: ["companyId"], where: { companyId: { in: ids }, status: { not: "TERMINATED" } }, _count: true })) add(key(r.companyId), r._count);
  } else if (q.metric === "po_spend") {
    const pos = await prisma.purchaseOrder.findMany({ where: { companyId: { in: ids }, status: "SENT_TO_SUPPLIER" }, select: { companyId: true, amountUsd: true, createdAt: true } });
    for (const p of pos) { const per = p.createdAt.toISOString().slice(0, 7); if (per >= q.from && per <= q.to) add(key(p.companyId, per), Number(p.amountUsd)); }
  } else {
    const deals = await prisma.deal.findMany({ where: { customer: { companyId: { in: ids } }, stage: q.metric === "won_deals" ? "WON" : { in: ["LEAD", "QUALIFIED", "PROPOSAL"] } },
      select: { valueUsd: true, updatedAt: true, customer: { select: { companyId: true } } } });
    for (const d of deals) { const per = d.updatedAt.toISOString().slice(0, 7); if (q.metric === "pipeline" || (per >= q.from && per <= q.to)) add(key(d.customer.companyId, per), Number(d.valueUsd)); }
  }

  const value = (v: { a: number; b: number }) => q.metric === "expenses" ? v.b : q.metric === "profit" ? v.a - v.b : q.metric === "margin" ? (v.a ? (v.a - v.b) / v.a : 0) : v.a;
  const rows = [...acc.entries()].map(([group, v]) => ({ group, value: Math.round(value(v) * 10000) / 10000 }))
    .sort((a, b) => q.groupBy === "period" ? a.group.localeCompare(b.group) : b.value - a.value);
  const unit = q.metric === "margin" ? "ratio" : q.metric === "headcount" ? "people" : "USD";
  if (q.format === "csv") {
    const esc = (s: unknown) => `"${String(s).replace(/"/g, '""')}"`;
    return res.type("text/csv").attachment(`atlasone_${q.metric}_by_${q.groupBy}.csv`).send([`${q.groupBy},${q.metric} (${unit})`, ...rows.map((r) => `${esc(r.group)},${r.value}`)].join("\n"));
  }
  res.json({ ...q, unit, total: q.metric === "margin" ? null : rows.reduce((s, r) => s + r.value, 0), rows });
});
