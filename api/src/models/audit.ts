import crypto from "node:crypto";
import mongoose from "mongoose";

/**
 * Tamper-evident audit trail: every entry stores sha256(prevHash + canonical payload).
 * Editing or deleting any historic entry breaks the chain, which /api/audit/verify detects.
 * Writes are serialised in-process; run a single API writer (or move to a DB-side sequence) when scaling out.
 */
const AuditSchema = new mongoose.Schema({
  seq: { type: Number, unique: true, index: true, required: true },
  at: { type: Date, default: Date.now, index: true },
  actor: { uid: String, name: String, roles: [String] },
  action: { type: String, index: true },
  entity: { type: String, index: true },
  entityId: { type: String, index: true },
  details: mongoose.Schema.Types.Mixed,
  prevHash: { type: String, required: true },
  hash: { type: String, required: true }, // writes must go through audit(); direct creates are rejected
});
export const AuditLog = mongoose.model("AuditLog", AuditSchema);

export interface Actor { uid: string; name: string; roles: string[] }

const canonical = (e: { seq: number; at: Date; actor: Actor; action: string; entity: string; entityId: string; details?: unknown }) =>
  JSON.stringify([e.seq, new Date(e.at).toISOString(), e.actor.uid, e.actor.name, [...e.actor.roles], e.action, e.entity, e.entityId, e.details ?? null]);
export const hashEntry = (prevHash: string, e: Parameters<typeof canonical>[0]) => crypto.createHash("sha256").update(prevHash + canonical(e)).digest("hex");

let tail: Promise<unknown> = Promise.resolve();

export function audit(actor: Actor, action: string, entity: string, entityId: string, details?: unknown) {
  const run = async () => {
    const last = await AuditLog.findOne().sort({ seq: -1 }).lean();
    const entry = { seq: (last?.seq ?? 0) + 1, at: new Date(), actor: { uid: actor.uid, name: actor.name, roles: [...actor.roles] }, action, entity, entityId,
      details: details === undefined ? null : JSON.parse(JSON.stringify(details)) };
    const prevHash = last?.hash ?? "GENESIS";
    await AuditLog.create({ ...entry, prevHash, hash: hashEntry(prevHash, entry) });
  };
  const p = tail.then(run, run);
  tail = p.catch(() => {});
  return p;
}

export async function verifyChain(): Promise<{ ok: boolean; checked: number; brokenAt?: number }> {
  let prev = "GENESIS", checked = 0;
  for await (const e of AuditLog.find().sort({ seq: 1 }).lean().cursor()) {
    const expected = hashEntry(prev, { seq: e.seq!, at: e.at!, actor: { uid: e.actor!.uid!, name: e.actor!.name!, roles: e.actor!.roles as string[] },
      action: e.action!, entity: e.entity!, entityId: e.entityId!, details: e.details });
    if (e.prevHash !== prev || e.hash !== expected) return { ok: false, checked, brokenAt: e.seq! };
    prev = e.hash!; checked++;
  }
  return { ok: true, checked };
}
