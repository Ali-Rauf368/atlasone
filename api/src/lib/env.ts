import "dotenv/config";
const req = (k: string) => { const v = process.env[k]; if (!v) throw new Error(`Missing env ${k}`); return v; };
export const env = {
  port: Number(process.env.PORT ?? 4000),
  mongoUrl: req("MONGO_URL"),
  jwtSecret: req("JWT_SECRET"),
  ingestKey: req("INGEST_API_KEY"),
  redisUrl: process.env.REDIS_URL,
  corsOrigin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",").map((s) => s.trim()) : true,
  ldap: {
    url: req("LDAP_URL"), baseDn: req("LDAP_BASE_DN"),
    bindDn: process.env.LDAP_BIND_DN, bindPassword: process.env.LDAP_BIND_PASSWORD,
    tlsCert: process.env.LDAP_TLS_CERT, tlsKey: process.env.LDAP_TLS_KEY,
    // Google Directory: map to custom-schema attributes exposed over Secure LDAP
    regionAttr: process.env.LDAP_REGION_ATTR ?? "ou", companyAttr: process.env.LDAP_COMPANY_ATTR ?? "departmentNumber",
  },
};
