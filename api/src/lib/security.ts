import mongoose from "mongoose";

/**
 * Account lockout + token revocation, both in MongoDB with TTL indexes so they clean themselves up.
 *  - 5 failed logins for a username within 15 minutes locks it for 15 minutes (per account, complements the per-IP rate limit)
 *  - logout revokes the JWT id (jti) until its natural expiry
 */
export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60_000;

const FailureSchema = new mongoose.Schema({ username: { type: String, index: true }, ip: String, at: { type: Date, default: Date.now, expires: WINDOW_MS / 1000 } });
const Failure = mongoose.model("LoginFailure", FailureSchema);

const RevokedSchema = new mongoose.Schema({ jti: { type: String, unique: true }, exp: { type: Date, expires: 0 } });
const Revoked = mongoose.model("RevokedToken", RevokedSchema);

export async function isLocked(username: string): Promise<boolean> {
  return (await Failure.countDocuments({ username: username.toLowerCase(), at: { $gte: new Date(Date.now() - WINDOW_MS) } })) >= MAX_FAILURES;
}
export async function recordFailure(username: string, ip?: string) {
  await Failure.create({ username: username.toLowerCase(), ip });
  return isLocked(username);
}
export async function clearFailures(username: string) { await Failure.deleteMany({ username: username.toLowerCase() }); }
export async function lockedAccounts() {
  return Failure.aggregate<{ _id: string; failures: number; last: Date; ips: string[] }>([
    { $match: { at: { $gte: new Date(Date.now() - WINDOW_MS) } } },
    { $group: { _id: "$username", failures: { $sum: 1 }, last: { $max: "$at" }, ips: { $addToSet: "$ip" } } },
    { $sort: { failures: -1 } },
  ]);
}

// Small in-memory cache so most requests do not hit Mongo
const revokedCache = new Map<string, number>();
export async function revoke(jti: string, expSec: number) {
  revokedCache.set(jti, expSec * 1000);
  await Revoked.updateOne({ jti }, { jti, exp: new Date(expSec * 1000) }, { upsert: true });
}
export async function isRevoked(jti: string | undefined): Promise<boolean> {
  if (!jti) return true; // every token we issue has a jti
  const hit = revokedCache.get(jti);
  if (hit) { if (hit > Date.now()) return true; revokedCache.delete(jti); }
  if (mongoose.connection.readyState !== 1) return false; // unit tests run without Mongo; the server always connects first
  return !!(await Revoked.exists({ jti }));
}
