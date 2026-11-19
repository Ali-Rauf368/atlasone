import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requirePerm } from "../middleware/auth.js";
import { scopeCompanyIds, inScope } from "../lib/scope.js";
import { audit } from "../models/audit.js";
import { invalidate } from "../lib/cache.js";

export const orgRouter = Router();

interface Node { id: string; code: string; name: string; country: string; region: string; currency: string; industry: string; employees: number; departments: { id: string; name: string; employees: number }[]; children: Node[] }

/** Organisation hierarchy: parent → subsidiaries → departments, with headcounts. Pruned to the caller's scope. */
orgRouter.get("/tree", requirePerm("org:read"), async (req, res) => {
  const scope = await scopeCompanyIds(req.user!);
  const companies = await prisma.company.findMany({ include: { departments: { include: { _count: { select: { employees: true } } } }, _count: { select: { employees: true } } }, orderBy: { name: "asc" } });
  const nodes = new Map<string, Node & { parentId: string | null }>(companies.map((c) => [c.id, {
    id: c.id, code: c.code, name: c.name, country: c.country, region: c.region, currency: c.currency, industry: c.industry, parentId: c.parentId,
    employees: c._count.employees, departments: c.departments.map((d) => ({ id: d.id, name: d.name, employees: d._count.employees })), children: [] }]));
  const roots: Node[] = [];
  for (const n of nodes.values()) (n.parentId && nodes.get(n.parentId) ? nodes.get(n.parentId)!.children : roots).push(n);
  const prune = (n: Node): Node | null => {
    const children = n.children.map(prune).filter((x): x is Node => !!x);
    return inScope(scope, n.id) || children.length ? { ...n, children } : null;
  };
  res.json(roots.map(prune).filter(Boolean));
});

const CompanySchema = z.object({ code: z.string().regex(/^[A-Z0-9-]{2,20}$/), name: z.string().min(2), country: z.string().min(2), region: z.string().min(2),
  currency: z.string().length(3).toUpperCase(), industry: z.string().min(2), parentId: z.string().optional() });

orgRouter.post("/companies", requirePerm("org:manage"), async (req, res) => {
  const d = CompanySchema.parse(req.body);
  if (!(await prisma.fxRate.findUnique({ where: { currency: d.currency } })) && d.currency !== "USD")
    return res.status(422).json({ error: `Add an FX rate for ${d.currency} first` });
  const parentId = d.parentId ?? (await prisma.company.findFirst({ where: { parentId: null } }))?.id;
  const c = await prisma.company.create({ data: { ...d, parentId } });
  for (const name of ["Finance", "Operations", "Sales", "HR"]) await prisma.department.create({ data: { name, companyId: c.id } });
  await prisma.budget.create({ data: { companyId: c.id, year: new Date().getFullYear(), amountUsd: 0 } });
  await audit(req.user!, "COMPANY_CREATED", "Company", c.id, d);
  await invalidate("dashboard:global");
  res.status(201).json(c);
});

orgRouter.post("/companies/:id/departments", requirePerm("org:manage"), async (req, res) => {
  const { name } = z.object({ name: z.string().min(2).max(80) }).parse(req.body);
  const d = await prisma.department.create({ data: { name, companyId: req.params.id } });
  await audit(req.user!, "DEPARTMENT_CREATED", "Department", d.id, { name, companyId: req.params.id });
  res.status(201).json(d);
});

// --- Country-specific configuration ---
orgRouter.get("/countries", requirePerm("org:read"), async (_req, res) => {
  const [configs, companies] = await Promise.all([prisma.countryConfig.findMany(), prisma.company.groupBy({ by: ["country"], _count: true })]);
  res.json(companies.map((c) => ({ country: c.country, companies: c._count, config: configs.find((x) => x.country === c.country) ?? null })).sort((a, b) => a.country.localeCompare(b.country)));
});

const CountrySchema = z.object({ timezone: z.string().refine((tz) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } }, "Unknown IANA timezone"),
  locale: z.string().min(2), fiscalYearStartMonth: z.number().int().min(1).max(12), vatRate: z.number().min(0).max(100),
  payrollCycle: z.enum(["MONTHLY", "SEMI_MONTHLY", "BIWEEKLY"]), dataResidency: z.enum(["EU", "US", "UK", "APAC", "LOCAL"]) });

orgRouter.put("/countries/:country", requirePerm("org:manage"), async (req, res) => {
  const d = CountrySchema.parse(req.body);
  const before = await prisma.countryConfig.findUnique({ where: { country: req.params.country } });
  const c = await prisma.countryConfig.upsert({ where: { country: req.params.country }, update: d, create: { ...d, country: req.params.country } });
  await audit(req.user!, "COUNTRY_CONFIG_CHANGED", "CountryConfig", c.country, { before, after: d });
  res.json(c);
});
