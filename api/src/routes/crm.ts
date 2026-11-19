import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requirePerm } from "../middleware/auth.js";
import { audit } from "../models/audit.js";
import { notifyRole } from "../lib/notify.js";
import { scopeCompanyIds, companyFilter, inScope } from "../lib/scope.js";

export const STAGES = ["LEAD", "QUALIFIED", "PROPOSAL", "WON", "LOST"] as const;
export const crmRouter = Router();

crmRouter.get("/customers", requirePerm("crm:read"), async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  res.json(await prisma.customer.findMany({ where: { ...companyFilter(await scopeCompanyIds(req.user!)), ...(q && { name: { contains: q, mode: "insensitive" as const } }) }, orderBy: { name: "asc" },
    include: { company: { select: { name: true } }, _count: { select: { deals: true, contracts: true } } } }));
});
crmRouter.post("/customers", requirePerm("crm:write"), async (req, res) => {
  const d = z.object({ name: z.string().min(2), country: z.string(), industry: z.string(), companyId: z.string() }).parse(req.body);
  if (!inScope(await scopeCompanyIds(req.user!), d.companyId)) return res.status(403).json({ error: "Company outside your scope" });
  const c = await prisma.customer.create({ data: d });
  await audit(req.user!, "CUSTOMER_CREATED", "Customer", c.id, d);
  res.status(201).json(c);
});

crmRouter.get("/pipeline", requirePerm("crm:read"), async (req, res) => {
  const deals = await prisma.deal.findMany({ where: { customer: companyFilter(await scopeCompanyIds(req.user!)) }, include: { customer: { select: { name: true, country: true } } }, orderBy: { valueUsd: "desc" } });
  res.json(STAGES.map((stage) => { const ds = deals.filter((d) => d.stage === stage); return { stage, count: ds.length, valueUsd: ds.reduce((a, d) => a + Number(d.valueUsd), 0), deals: ds }; }));
});
crmRouter.post("/deals", requirePerm("crm:write"), async (req, res) => {
  const d = z.object({ title: z.string().min(2), customerId: z.string(), valueUsd: z.number().positive() }).parse(req.body);
  const deal = await prisma.deal.create({ data: { ...d, owner: req.user!.uid } });
  await audit(req.user!, "DEAL_CREATED", "Deal", deal.id, d);
  res.status(201).json(deal);
});
crmRouter.patch("/deals/:id", requirePerm("crm:write"), async (req, res) => {
  const { stage } = z.object({ stage: z.enum(STAGES) }).parse(req.body);
  const deal = await prisma.deal.update({ where: { id: req.params.id }, data: { stage } });
  await audit(req.user!, "DEAL_STAGE_CHANGED", "Deal", deal.id, { stage });
  if (stage === "WON") notifyRole("GLOBAL_CEO", { title: "Deal won", body: `${deal.title}: $${Number(deal.valueUsd).toLocaleString()}`, link: "/crm" });
  res.json(deal);
});

crmRouter.get("/contracts", requirePerm("crm:read"), async (req, res) =>
  res.json(await prisma.contract.findMany({ where: { customer: companyFilter(await scopeCompanyIds(req.user!)) }, include: { customer: { select: { name: true } } }, orderBy: { endsAt: "asc" } })));

crmRouter.get("/performance", requirePerm("crm:read"), async (_req, res) => {
  const won = await prisma.deal.groupBy({ by: ["owner"], where: { stage: "WON" }, _sum: { valueUsd: true }, _count: true });
  const all = await prisma.deal.groupBy({ by: ["owner"], where: { stage: { in: ["WON", "LOST"] } }, _count: true });
  res.json(won.map((w) => ({ owner: w.owner, wonUsd: Number(w._sum.valueUsd ?? 0), won: w._count,
    winRate: w._count / (all.find((a) => a.owner === w.owner)?._count ?? w._count) })).sort((a, b) => b.wonUsd - a.wonUsd));
});
