// Lightweight LDAP server for local development without Docker.
// Serves the same directory as the OpenLDAP container by reading seed.ldif.
// Usage (from api/): node ../infra/ldap/dev-server.mjs [port=3890]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(path.join(process.cwd(), "package.json"));
const ldap = require("ldapjs");

const BASE = "dc=atlasone,dc=dev";
const ADMIN = { dn: `cn=admin,${BASE}`, password: process.env.LDAP_ADMIN_PASSWORD ?? "admin" };
const port = Number(process.argv[2] ?? process.env.LDAP_PORT ?? 3890);

const ldif = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "seed.ldif"), "utf8");
const entries = ldif.split(/\n\s*\n/).map((block) => {
  const attrs = {};
  let dn = null;
  for (const line of block.split("\n").filter((l) => l.trim() && !l.startsWith("#"))) {
    const i = line.indexOf(":");
    const k = line.slice(0, i).trim(), v = line.slice(i + 1).trim();
    if (k === "dn") dn = v; else (attrs[k] ??= []).push(v);
  }
  return dn && { dn: dn.toLowerCase(), rawDn: dn, attrs };
}).filter(Boolean);

const server = ldap.createServer();
const norm = (dn) => String(dn).replace(/\s+/g, "").toLowerCase();

server.bind(BASE, (req, res, next) => {
  const dn = norm(req.dn.toString()), pw = req.credentials;
  if (dn === norm(ADMIN.dn) && pw === ADMIN.password) { res.end(); return next(); }
  const e = entries.find((x) => norm(x.dn) === dn);
  if (e && e.attrs.userPassword?.[0] === pw) { res.end(); return next(); }
  return next(new ldap.InvalidCredentialsError());
});

server.search(BASE, (req, res, next) => {
  const base = norm(req.dn.toString());
  for (const e of entries) {
    if (!norm(e.dn).endsWith(base)) continue;
    const all = Object.fromEntries(Object.entries(e.attrs).filter(([k]) => k !== "userPassword"));
    // ldapjs filters match on lower-cased attribute names
    const probe = Object.fromEntries(Object.entries(all).map(([k, v]) => [k.toLowerCase(), v]));
    if (!req.filter.matches(probe)) continue;
    // Do attribute selection ourselves (case-insensitive) and keep schema casing, like a real directory
    const wanted = req.attributes.map((a) => a.toLowerCase()).filter((a) => a !== "dn");
    const attributes = wanted.length && !wanted.includes("*") ? Object.fromEntries(Object.entries(all).filter(([k]) => wanted.includes(k.toLowerCase()))) : all;
    res.attributes = []; // stop ldapjs re-filtering with its case-sensitive comparison
    res.send({ dn: e.rawDn, attributes }, true);
  }
  res.end(); next();
});

server.listen(port, "127.0.0.1", () => console.log(`dev LDAP on ldap://127.0.0.1:${port} (${entries.length} entries, base ${BASE})`));
