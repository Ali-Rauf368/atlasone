import { Router } from "express";
import { prisma } from "../lib/db.js";
import { requirePerm } from "../middleware/auth.js";
import { cached } from "../lib/cache.js";
import { scopeCompanyIds } from "../lib/scope.js";

export const dashboardRouter = Router();

dashboardRouter.get("/global", requirePerm("dashboard:global"), async (_req, res) => {
  res.json(await cached("dashboard:global", 60, buildGlobal));
});

async function buildGlobal() {
  const companies = await prisma.company.findMany({ include: { _count: { select: { employees: true } } } });
  const sums = await prisma.financialEntry.groupBy({ by: ["companyId", "type"], _sum: { amountUsd: true } });
  const monthly = await prisma.financialEntry.groupBy({ by: ["period", "type"], _sum: { amountUsd: true }, orderBy: { period: "asc" } });
  const get = (id: string, t: string) => Number(sums.find((s) => s.companyId === id && s.type === t)?._sum.amountUsd ?? 0);

  const byCompany = companies.map((c) => {
    const revenue = get(c.id, "REVENUE"), expenses = get(c.id, "EXPENSE");
    return { id: c.id, code: c.code, name: c.name, country: c.country, region: c.region, employees: c._count.employees,
      revenue, expenses, profit: revenue - expenses, margin: revenue ? (revenue - expenses) / revenue : 0 };
  });
  const periods = [...new Set(monthly.map((m) => m.period))];
  return {
    kpis: {
      revenue: byCompany.reduce((a, c) => a + c.revenue, 0),
      subsidiaries: companies.filter((c) => c.parentId).length,
      employees: byCompany.reduce((a, c) => a + c.employees, 0),
      countries: new Set(companies.map((c) => c.country)).size,
      pendingApprovals: await prisma.purchaseOrder.count({ where: { status: "PENDING_APPROVAL" } }),
    },
    byCompany,
    underperforming: byCompany.filter((c) => c.revenue > 0 && c.margin < 0.1),
    trend: periods.map((p) => ({
      period: p,
      revenue: Number(monthly.find((m) => m.period === p && m.type === "REVENUE")?._sum.amountUsd ?? 0),
      expenses: Number(monthly.find((m) => m.period === p && m.type === "EXPENSE")?._sum.amountUsd ?? 0),
    })),
  };
}

dashboardRouter.get("/companies", async (req, res) => {
  const scope = await scopeCompanyIds(req.user!);
  res.json(await prisma.company.findMany({ where: scope ? { id: { in: scope } } : {}, orderBy: { name: "asc" } }));
});
