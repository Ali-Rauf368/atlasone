import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { toUsd } from "../lib/fx.js";
import { env } from "../lib/env.js";
import { audit } from "../models/audit.js";
import { invalidate } from "../lib/cache.js";

// Endpoints called by Apache NiFi flows (InvokeHTTP), authenticated with an API key.
export const ingestRouter = Router();
ingestRouter.use((req: Request, res: Response, next: NextFunction) =>
  req.header("x-api-key") === env.ingestKey ? next() : res.status(401).json({ error: "Bad API key" }));

const Row = z.object({ companyCode: z.string(), period: z.string().regex(/^\d{4}-\d{2}$/), type: z.enum(["REVENUE", "EXPENSE"]),
  category: z.string(), amount: z.coerce.number(), currency: z.string().length(3) });

ingestRouter.post("/financials", async (req, res) => {
  const rows = z.array(Row).safeParse(Array.isArray(req.body) ? req.body : [req.body]);
  if (!rows.success) return res.status(400).json({ error: rows.error.flatten() });
  let inserted = 0; const errors: string[] = [];
  for (const r of rows.data) {
    const company = await prisma.company.findUnique({ where: { code: r.companyCode } });
    if (!company) { errors.push(`Unknown company ${r.companyCode}`); continue; }
    try {
      await prisma.financialEntry.create({ data: { companyId: company.id, period: r.period, type: r.type, category: r.category,
        amount: r.amount, currency: r.currency, amountUsd: await toUsd(r.amount, r.currency), source: "nifi" } });
      inserted++;
    } catch (e) { errors.push((e as Error).message); }
  }
  await audit({ uid: "nifi", name: "Apache NiFi", roles: ["INTEGRATION"] }, "FINANCIALS_INGESTED", "FinancialEntry", "batch", { inserted, errors });
  if (inserted) await invalidate("dashboard:global");
  res.json({ inserted, errors });
});

ingestRouter.post("/fx-rates", async (req, res) => {
  const rates = z.record(z.coerce.number()).parse(req.body);
  for (const [currency, toUsd] of Object.entries(rates))
    await prisma.fxRate.upsert({ where: { currency }, update: { toUsd }, create: { currency, toUsd } });
  res.json({ updated: Object.keys(rates).length });
});
