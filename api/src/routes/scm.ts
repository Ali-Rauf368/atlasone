import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/db.js";
import { requirePerm } from "../middleware/auth.js";
import { audit } from "../models/audit.js";
import { notifyRole } from "../lib/notify.js";
import { scopeCompanyIds, companyFilter, inScope } from "../lib/scope.js";

export const scmRouter = Router();

scmRouter.get("/suppliers", requirePerm("scm:read"), async (_req, res) => res.json(await prisma.supplier.findMany({ orderBy: { name: "asc" } })));
scmRouter.post("/suppliers", requirePerm("scm:write"), async (req, res) => {
  const d = z.object({ name: z.string().min(2), country: z.string(), email: z.string().email(), rating: z.number().int().min(1).max(5).default(3) }).parse(req.body);
  const s = await prisma.supplier.create({ data: d });
  await audit(req.user!, "SUPPLIER_CREATED", "Supplier", s.id, d);
  res.status(201).json(s);
});

scmRouter.get("/inventory", requirePerm("scm:read"), async (req, res) => {
  const lowOnly = req.query.low === "true";
  const scope = await scopeCompanyIds(req.user!);
  const items = await prisma.inventoryItem.findMany({ where: { warehouse: companyFilter(scope) }, include: { warehouse: { include: { company: { select: { name: true } } } } }, orderBy: { sku: "asc" } });
  res.json(lowOnly ? items.filter((i) => i.quantity <= i.reorderAt) : items);
});

scmRouter.post("/inventory/:id/adjust", requirePerm("scm:write"), async (req, res) => {
  const { delta, reason } = z.object({ delta: z.number().int(), reason: z.string() }).parse(req.body);
  const scope = await scopeCompanyIds(req.user!);
  const item = await prisma.$transaction(async (tx) => {
    const cur = await tx.inventoryItem.findUniqueOrThrow({ where: { id: req.params.id }, include: { warehouse: true } });
    if (!inScope(scope, cur.warehouse.companyId)) throw Object.assign(new Error("Not found"), { status: 404 });
    if (cur.quantity + delta < 0) throw Object.assign(new Error("Insufficient stock"), { status: 422 });
    return tx.inventoryItem.update({ where: { id: cur.id }, data: { quantity: { increment: delta } }, include: { warehouse: true } });
  });
  await audit(req.user!, "INVENTORY_ADJUSTED", "InventoryItem", item.id, { delta, reason, quantity: item.quantity });
  if (item.quantity <= item.reorderAt)
    notifyRole("DEPARTMENT_MANAGER", { title: "Low stock", body: `${item.sku} at ${item.warehouse.name}: ${item.quantity} left`, link: "/supply-chain" });
  res.json(item);
});

scmRouter.get("/warehouses", requirePerm("scm:read"), async (req, res) => {
  const ws = await prisma.warehouse.findMany({ where: companyFilter(await scopeCompanyIds(req.user!)), include: { company: { select: { name: true } }, items: { select: { quantity: true, reorderAt: true } } } });
  res.json(ws.map(({ items, ...w }) => ({ ...w, skus: items.length, units: items.reduce((a, i) => a + i.quantity, 0), lowStock: items.filter((i) => i.quantity <= i.reorderAt).length })));
});

scmRouter.get("/shipments", requirePerm("scm:read"), async (_req, res) => res.json(await prisma.shipment.findMany({ orderBy: { eta: "asc" } })));
scmRouter.patch("/shipments/:id", requirePerm("scm:write"), async (req, res) => {
  const { status } = z.object({ status: z.enum(["IN_TRANSIT", "DELIVERED", "DELAYED"]) }).parse(req.body);
  const s = await prisma.shipment.update({ where: { id: req.params.id }, data: { status } });
  await audit(req.user!, "SHIPMENT_STATUS", "Shipment", s.id, { status });
  res.json(s);
});
