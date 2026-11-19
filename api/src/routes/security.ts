import { Router } from "express";
import { requirePerm } from "../middleware/auth.js";
import { AuditLog } from "../models/audit.js";
import { lockedAccounts, MAX_FAILURES } from "../lib/security.js";
import { PERMISSIONS, ROLES } from "../lib/rbac.js";
import { DEFAULT_RULES } from "../lib/workflow.js";

export const securityRouter = Router();

/** Security monitoring: login activity, brute-force indicators, risky governance events. */
securityRouter.get("/overview", requirePerm("security:read"), async (_req, res) => {
  const since = new Date(Date.now() - 24 * 3600_000);
  const counts = await AuditLog.aggregate<{ _id: string; n: number }>([{ $match: { at: { $gte: since }, action: { $in: ["LOGIN", "LOGIN_FAILED", "ACCOUNT_LOCKED", "LOGIN_BLOCKED", "LOGOUT"] } } }, { $group: { _id: "$action", n: { $sum: 1 } } }]);
  const c = (a: string) => counts.find((x) => x._id === a)?.n ?? 0;
  const hourly = await AuditLog.aggregate<{ _id: { h: string; ok: boolean }; n: number }>([
    { $match: { at: { $gte: since }, action: { $in: ["LOGIN", "LOGIN_FAILED"] } } },
    { $group: { _id: { h: { $dateToString: { format: "%H:00", date: "$at" } }, ok: { $eq: ["$action", "LOGIN"] } }, n: { $sum: 1 } } }]);
  const hours = [...new Set(hourly.map((x) => x._id.h))].sort();

  // Risky events: lockouts, SLA breaches, config changes, failed budget checks, off-hours approvals (22:00–06:00 UTC)
  const risky = await AuditLog.find({ at: { $gte: new Date(Date.now() - 7 * 864e5) }, $or: [
    { action: { $in: ["ACCOUNT_LOCKED", "LOGIN_BLOCKED", "PO_SLA_BREACHED", "WORKFLOW_RULES_CHANGED", "FX_RATE_CHANGED", "COUNTRY_CONFIG_CHANGED", "PO_BUDGET_CHECK_FAILED", "BUDGET_SET"] } },
    { action: "PO_STEP_APPROVED", $expr: { $or: [{ $gte: [{ $hour: "$at" }, 22] }, { $lt: [{ $hour: "$at" }, 6] }] } },
  ] }).sort({ at: -1 }).limit(50).lean();

  res.json({
    last24h: { logins: c("LOGIN"), failed: c("LOGIN_FAILED"), lockouts: c("ACCOUNT_LOCKED"), blocked: c("LOGIN_BLOCKED"), logouts: c("LOGOUT") },
    loginTrend: hours.map((h) => ({ hour: h, success: hourly.find((x) => x._id.h === h && x._id.ok)?.n ?? 0, failed: hourly.find((x) => x._id.h === h && !x._id.ok)?.n ?? 0 })),
    suspiciousAccounts: (await lockedAccounts()).map((a) => ({ username: a._id, failures: a.failures, last: a.last, ips: a.ips, locked: a.failures >= MAX_FAILURES })),
    risky: risky.map((r) => ({ at: r.at, action: r.action, actor: r.actor?.uid, entityId: r.entityId, offHours: r.action === "PO_STEP_APPROVED" })),
  });
});

/** Access policies, read-only: role → permission matrix and active controls. */
securityRouter.get("/policies", requirePerm("security:read"), (_req, res) => {
  res.json({
    roles: ROLES,
    matrix: Object.entries(PERMISSIONS).map(([permission, roles]) => ({ permission, roles })),
    controls: [
      { name: "Directory authentication", detail: "LDAP bind against Google Workspace / OpenLDAP; roles from group membership" },
      { name: "Session lifetime", detail: "JWT 8h, HS256, revocable on logout" },
      { name: "Account lockout", detail: `${MAX_FAILURES} failures in 15 min → 15 min lock` },
      { name: "Rate limiting", detail: "20 login attempts / 15 min / IP; 600 API calls / min / IP" },
      { name: "Segregation of duties", detail: "Creators can never approve their own purchase orders" },
      { name: "Data scoping", detail: "Region (directors) / company (managers) row-level filters" },
      { name: "Audit integrity", detail: "SHA-256 hash chain, verifiable on demand" },
      { name: "Approval matrix", detail: `${DEFAULT_RULES.length} default amount bands; CEO sign-off ≥ $100k` },
    ],
  });
});
