export const ROLES = ["SUPER_ADMIN", "GLOBAL_CEO", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "DEPARTMENT_MANAGER", "FINANCE", "EMPLOYEE"] as const;
export type Role = (typeof ROLES)[number];

export const PERMISSIONS = {
  "dashboard:global": ["SUPER_ADMIN", "GLOBAL_CEO"],
  "org:read": ["SUPER_ADMIN", "GLOBAL_CEO", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "FINANCE"],
  "po:create": ["DEPARTMENT_MANAGER", "REGIONAL_DIRECTOR", "COMPANY_ADMIN"],
  "po:read": ["SUPER_ADMIN", "GLOBAL_CEO", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "DEPARTMENT_MANAGER", "FINANCE"],
  "po:approve:regional": ["REGIONAL_DIRECTOR"],
  "po:approve:finance": ["FINANCE"],
  "audit:read": ["SUPER_ADMIN", "GLOBAL_CEO", "FINANCE"],
  "workflow:manage": ["SUPER_ADMIN", "GLOBAL_CEO"],
  "org:manage": ["SUPER_ADMIN", "GLOBAL_CEO"],
  "finance:manage": ["SUPER_ADMIN", "FINANCE"],
  "security:read": ["SUPER_ADMIN", "GLOBAL_CEO"],
  "hr:read": ["SUPER_ADMIN", "GLOBAL_CEO", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "DEPARTMENT_MANAGER", "FINANCE"],
  "hr:write": ["SUPER_ADMIN", "COMPANY_ADMIN", "DEPARTMENT_MANAGER"],
  "hr:approve": ["DEPARTMENT_MANAGER", "COMPANY_ADMIN", "REGIONAL_DIRECTOR"],
  "payroll:read": ["SUPER_ADMIN", "GLOBAL_CEO", "FINANCE", "COMPANY_ADMIN"],
  "scm:read": ["SUPER_ADMIN", "GLOBAL_CEO", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "DEPARTMENT_MANAGER", "FINANCE"],
  "scm:write": ["SUPER_ADMIN", "COMPANY_ADMIN", "DEPARTMENT_MANAGER", "REGIONAL_DIRECTOR"],
  "crm:read": ["SUPER_ADMIN", "GLOBAL_CEO", "REGIONAL_DIRECTOR", "COMPANY_ADMIN", "DEPARTMENT_MANAGER"],
  "crm:write": ["SUPER_ADMIN", "COMPANY_ADMIN", "DEPARTMENT_MANAGER", "REGIONAL_DIRECTOR"],
} as const satisfies Record<string, readonly Role[]>;
export type Permission = keyof typeof PERMISSIONS;

export const can = (roles: Role[], p: Permission) => roles.some((r) => (PERMISSIONS[p] as readonly Role[]).includes(r));
