import { Router } from "express";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { authenticate } from "../lib/ldap.js";
import { env } from "../lib/env.js";
import { audit } from "../models/audit.js";
import { clearFailures, isLocked, recordFailure, revoke } from "../lib/security.js";
import { requireAuth } from "../middleware/auth.js";

export const authRouter = Router();
const anon = (username: string) => ({ uid: username || "(empty)", name: "Unauthenticated", roles: [] as string[] });

authRouter.post("/login", async (req, res) => {
  const username = String(req.body?.username ?? "").trim().slice(0, 100);
  const password = String(req.body?.password ?? "");

  if (await isLocked(username)) {
    await audit(anon(username), "LOGIN_BLOCKED", "User", username, { ip: req.ip });
    return res.status(423).json({ error: "Account temporarily locked after repeated failures. Try again in 15 minutes." });
  }
  let user;
  try { user = await authenticate(username, password); }
  catch (e) { console.error("LDAP error:", (e as Error).message); return res.status(503).json({ error: "Directory unavailable" }); }

  if (!user) {
    const locked = await recordFailure(username, req.ip);
    await audit(anon(username), locked ? "ACCOUNT_LOCKED" : "LOGIN_FAILED", "User", username, { ip: req.ip, userAgent: req.header("user-agent") });
    return res.status(401).json({ error: "Invalid credentials" });
  }
  await clearFailures(username);
  await audit(user, "LOGIN", "User", user.uid, { ip: req.ip });
  const token = jwt.sign(user, env.jwtSecret, { expiresIn: "8h", jwtid: crypto.randomUUID() });
  res.json({ token, user });
});

authRouter.post("/logout", requireAuth, async (req, res) => {
  const { jti, exp } = jwt.decode(req.headers.authorization!.slice(7)) as { jti: string; exp: number };
  await revoke(jti, exp);
  await audit(req.user!, "LOGOUT", "User", req.user!.uid);
  res.json({ ok: true });
});
