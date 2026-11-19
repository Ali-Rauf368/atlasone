import { Router } from "express";
import { AuditLog, verifyChain } from "../models/audit.js";
import { requirePerm } from "../middleware/auth.js";

export const auditRouter = Router();
auditRouter.get("/verify", requirePerm("audit:read"), async (_req, res) => res.json(await verifyChain()));

auditRouter.get("/", requirePerm("audit:read"), async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (typeof req.query.entityId === "string") filter.entityId = req.query.entityId;
  if (typeof req.query.action === "string") filter.action = req.query.action;
  res.json(await AuditLog.find(filter).sort({ at: -1 }).limit(200).lean());
});
