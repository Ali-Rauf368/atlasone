import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env.js";
import { can, type Permission } from "../lib/rbac.js";
import type { LdapUser } from "../lib/ldap.js";
import { isRevoked } from "../lib/security.js";

declare global { namespace Express { interface Request { user?: LdapUser } } }

export async function verifyToken(token: string): Promise<LdapUser | null> {
  try {
    const claims = jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }) as LdapUser & { jti?: string };
    if (await isRevoked(claims.jti)) return null;
    const { uid, name, email, roles, region, companyCode } = claims;
    return { uid, name, email, roles, region, companyCode };
  } catch { return null; }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace(/^Bearer /, "");
  if (!token) return res.status(401).json({ error: "Unauthenticated" });
  const user = await verifyToken(token);
  if (!user) return res.status(401).json({ error: "Invalid or expired session" });
  req.user = user;
  next();
}

export const requirePerm = (p: Permission) => (req: Request, res: Response, next: NextFunction) =>
  req.user && can(req.user.roles, p) ? next() : res.status(403).json({ error: `Missing permission ${p}` });
