import { Client } from "ldapts";
import fs from "node:fs";
import { env } from "./env.js";
import { ROLES, type Role } from "./rbac.js";

export interface LdapUser { uid: string; name: string; email: string; roles: Role[]; region?: string; companyCode?: string }

function client() {
  const { tlsCert, tlsKey, url } = env.ldap;
  // Google Secure LDAP authenticates the *client* with a certificate.
  const tlsOptions = tlsCert && tlsKey ? { cert: fs.readFileSync(tlsCert), key: fs.readFileSync(tlsKey) } : undefined;
  return new Client({ url, tlsOptions });
}

const escapeFilter = (v: string) => v.replace(/[\\*()\0]/g, (c) => "\\" + c.charCodeAt(0).toString(16).padStart(2, "0"));

export async function authenticate(uid: string, password: string): Promise<LdapUser | null> {
  if (!/^[a-zA-Z0-9._@-]+$/.test(uid) || !password) return null;
  const c = client();
  try {
    if (env.ldap.bindDn) await c.bind(env.ldap.bindDn, env.ldap.bindPassword ?? "");
    const { searchEntries } = await c.search(env.ldap.baseDn, {
      scope: "sub", filter: `(|(uid=${uid})(mail=${uid}))`, attributes: ["dn", "uid", "cn", "mail", env.ldap.regionAttr, env.ldap.companyAttr],
    });
    const entry = searchEntries[0];
    if (!entry) return null;

    const userClient = client();
    try { await userClient.bind(entry.dn, password); } catch { return null; } finally { await userClient.unbind(); }

    const groups = await c.search(env.ldap.baseDn, {
      scope: "sub", filter: `(&(objectClass=groupOfNames)(member=${escapeFilter(entry.dn)}))`, attributes: ["cn"],
    });
    const roles = groups.searchEntries.map((g) => String(g.cn)).filter((r): r is Role => (ROLES as readonly string[]).includes(r));
    // Attribute names are case-insensitive in LDAP; missing attributes come back as [] — treat both as "not set"
    const attr = (k: string) => {
      const key = Object.keys(entry).find((x) => x.toLowerCase() === k.toLowerCase());
      const v = key ? entry[key] : undefined;
      const first = Array.isArray(v) ? v[0] : v;
      return first ? String(first) : undefined;
    };
    return { uid: String(entry.uid), name: String(entry.cn), email: String(entry.mail), roles: roles.length ? roles : ["EMPLOYEE"],
      region: attr(env.ldap.regionAttr), companyCode: attr(env.ldap.companyAttr) };
  } finally { await c.unbind(); }
}
