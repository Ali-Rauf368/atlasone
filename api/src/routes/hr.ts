import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { toUsd } from "../lib/fx.js";
import { requirePerm } from "../middleware/auth.js";
import { audit } from "../models/audit.js";
import { invalidate } from "../lib/cache.js";
import { scopeCompanyIds, companyFilter, inScope } from "../lib/scope.js";

export const hrRouter = Router();

hrRouter.get("/employees", requirePerm("hr:read"), async (req, res) => {
  const { companyId, q, page = "1" } = req.query as Record<string, string>;
  const scope = await scopeCompanyIds(req.user!);
  if (companyId && !inScope(scope, companyId)) return res.status(403).json({ error: "Company outside your scope" });
  const where = { ...companyFilter(scope), ...(companyId && { companyId }), ...(q && { OR: [{ name: { contains: q, mode: "insensitive" as const } }, { email: { contains: q, mode: "insensitive" as const } }] }) };
  const take = 25, skip = (Math.max(1, Number(page)) - 1) * take;
  const [total, rows] = await Promise.all([
    prisma.employee.count({ where }),
    prisma.employee.findMany({ where, take, skip, orderBy: { name: "asc" }, include: { company: { select: { name: true, country: true } }, department: { select: { name: true } } } }),
  ]);
  res.json({ total, page: Number(page), pageSize: take, rows });
});

hrRouter.get("/distribution", requirePerm("hr:read"), async (req, res) => {
  const groups = await prisma.employee.groupBy({ by: ["companyId", "status"], where: companyFilter(await scopeCompanyIds(req.user!)), _count: true });
  const companies = await prisma.company.findMany({ select: { id: true, name: true, country: true } });
  res.json(companies.map((c) => ({ ...c, active: groups.find((g) => g.companyId === c.id && g.status === "ACTIVE")?._count ?? 0,
    onboarding: groups.find((g) => g.companyId === c.id && g.status === "ONBOARDING")?._count ?? 0 })).filter((c) => c.active + c.onboarding > 0));
});

const Hire = z.object({ name: z.string().min(2), email: z.string().email(), title: z.string(), companyId: z.string(), departmentId: z.string().optional(), salary: z.number().nonnegative() });
hrRouter.post("/employees", requirePerm("hr:write"), async (req, res) => {
  const data = Hire.parse(req.body);
  if (!inScope(await scopeCompanyIds(req.user!), data.companyId)) return res.status(403).json({ error: "Company outside your scope" });
  const emp = await prisma.employee.create({ data: { ...data, status: "ONBOARDING" } });
  await audit(req.user!, "EMPLOYEE_ONBOARDED", "Employee", emp.id, { name: emp.name, companyId: emp.companyId });
  await invalidate("dashboard:global");
  res.status(201).json(emp);
});

hrRouter.patch("/employees/:id", requirePerm("hr:write"), async (req, res) => {
  const data = z.object({ status: z.enum(["ONBOARDING", "ACTIVE", "TERMINATED"]).optional(), rating: z.number().int().min(1).max(5).optional(), title: z.string().optional() }).parse(req.body);
  const emp = await prisma.employee.update({ where: { id: req.params.id }, data });
  await audit(req.user!, "EMPLOYEE_UPDATED", "Employee", emp.id, data);
  res.json(emp);
});

hrRouter.get("/leave", requirePerm("hr:read"), async (req, res) => {
  res.json(await prisma.leaveRequest.findMany({ where: { employee: companyFilter(await scopeCompanyIds(req.user!)) }, orderBy: { createdAt: "desc" }, take: 100, include: { employee: { select: { name: true, company: { select: { name: true } } } } } }));
});
hrRouter.post("/leave", requirePerm("hr:write"), async (req, res) => {
  const d = z.object({ employeeId: z.string(), from: z.coerce.date(), to: z.coerce.date(), reason: z.string() }).refine((x) => x.to >= x.from, "to must be after from").parse(req.body);
  const lr = await prisma.leaveRequest.create({ data: d });
  await audit(req.user!, "LEAVE_REQUESTED", "LeaveRequest", lr.id, d);
  res.status(201).json(lr);
});
hrRouter.post("/leave/:id/decision", requirePerm("hr:approve"), async (req, res) => {
  const { decision } = z.object({ decision: z.enum(["APPROVED", "REJECTED"]) }).parse(req.body);
  const lr = await prisma.leaveRequest.update({ where: { id: req.params.id }, data: { status: decision } });
  await audit(req.user!, `LEAVE_${decision}`, "LeaveRequest", lr.id);
  res.json(lr);
});

hrRouter.get("/attendance", requirePerm("hr:read"), async (_req, res) => {
  const since = new Date(Date.now() - 30 * 864e5);
  const rows = await prisma.attendance.groupBy({ by: ["present"], where: { date: { gte: since } }, _count: true });
  const present = rows.find((r) => r.present)?._count ?? 0, total = rows.reduce((a, r) => a + r._count, 0);
  res.json({ days: 30, rate: total ? present / total : null });
});

hrRouter.get("/payroll", requirePerm("payroll:read"), async (_req, res) => {
  const companies = await prisma.company.findMany({ include: { employees: { where: { status: { not: "TERMINATED" } }, select: { salary: true } } } });
  res.json(await Promise.all(companies.filter((c) => c.employees.length).map(async (c) => {
    const local = c.employees.reduce((a, e) => a + Number(e.salary), 0);
    return { company: c.name, currency: c.currency, headcount: c.employees.length, monthlyLocal: local, monthlyUsd: await toUsd(local, c.currency) };
  })));
});

hrRouter.get("/recruitment", requirePerm("hr:read"), async (_req, res) => res.json(await prisma.jobOpening.findMany({ orderBy: { createdAt: "desc" } })));
hrRouter.post("/recruitment", requirePerm("hr:write"), async (req, res) => {
  const d = z.object({ companyId: z.string(), title: z.string().min(2) }).parse(req.body);
  const j = await prisma.jobOpening.create({ data: d });
  await audit(req.user!, "JOB_OPENED", "JobOpening", j.id, d);
  res.status(201).json(j);
});
