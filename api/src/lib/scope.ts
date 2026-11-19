import { prisma } from "./db.js";
import type { LdapUser } from "./ldap.js";

/**
 * Row-level data scoping (tenant isolation inside the group).
 * Returns null = unrestricted, otherwise the company ids the user may see.
 *  - GLOBAL_CEO / SUPER_ADMIN / FINANCE (group finance): whole group
 *  - REGIONAL_DIRECTOR: every company in their region (LDAP attribute, default `ou`)
 *  - everyone else: their own company (LDAP attribute, default `departmentNumber` = company code)
 */
export async function scopeCompanyIds(user: LdapUser): Promise<string[] | null> {
  if (user.roles.some((r) => r === "GLOBAL_CEO" || r === "SUPER_ADMIN" || r === "FINANCE")) return null;
  const where = user.roles.includes("REGIONAL_DIRECTOR") && user.region ? { region: user.region }
    : user.companyCode ? { code: user.companyCode } : null;
  if (!where) return [];
  return (await prisma.company.findMany({ where, select: { id: true } })).map((c) => c.id);
}

export const companyFilter = (ids: string[] | null) => (ids ? { companyId: { in: ids } } : {});
export const inScope = (ids: string[] | null, companyId: string) => ids === null || ids.includes(companyId);
