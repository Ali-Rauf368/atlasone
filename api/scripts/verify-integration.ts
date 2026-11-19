// Integration check against real Postgres + LDAP (no Mongo needed).
// Usage: DATABASE_URL=... LDAP_URL=... npx tsx scripts/verify-integration.ts
import { authenticate } from "../src/lib/ldap.js";
import { scopeCompanyIds } from "../src/lib/scope.js";
import { prisma } from "../src/lib/db.js";
import { pickRule, checkApprover, checkBudget } from "../src/lib/workflow.js";
import { loadRules } from "../src/routes/purchaseOrders.js";
import { detectAnomalies } from "../src/lib/anomaly.js";
import { toUsd } from "../src/lib/fx.js";

let failed = 0;
const check = (name: string, ok: boolean, info = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`); if (!ok) failed++; };

const ceo = await authenticate("ceo", "password");
check("LDAP: CEO logs in with GLOBAL_CEO role", !!ceo?.roles.includes("GLOBAL_CEO"), ceo?.roles.join(","));
check("LDAP: wrong password rejected", (await authenticate("ceo", "nope")) === null);
check("LDAP: unknown user rejected", (await authenticate("ghost", "password")) === null);
check("LDAP: filter-injection username rejected", (await authenticate("*)(uid=*", "password")) === null);
const director = await authenticate("director", "password");
check("LDAP: director region from directory", director?.region === "Europe", director?.region);
const manager = await authenticate("manager", "password");
check("LDAP: manager company from directory", manager?.companyCode === "DE-TECH", manager?.companyCode);
const managerPk = await authenticate("manager.pk", "password");
const finance = await authenticate("finance", "password");

const names = async (ids: string[] | null) => ids === null ? "ALL" : (await prisma.company.findMany({ where: { id: { in: ids } } })).map((c) => c.code).sort().join(",");
check("Scope: CEO sees whole group", (await scopeCompanyIds(ceo!)) === null);
check("Scope: finance sees whole group", (await scopeCompanyIds(finance!)) === null);
check("Scope: EU director sees DE + UK only", (await names(await scopeCompanyIds(director!))) === "DE-TECH,UK-LOG", await names(await scopeCompanyIds(director!)));
check("Scope: DE manager sees DE only", (await names(await scopeCompanyIds(manager!))) === "DE-TECH");
check("Scope: PK manager sees PK only", (await names(await scopeCompanyIds(managerPk!))) === "PK-PHARMA");

const rules = await loadRules();
check("Workflow: 3 rules loaded from DB", rules.length === 3);
const eur5k = await toUsd(5000, "EUR");
check("FX: €5,000 → $5,400", eur5k === 5400, String(eur5k));
check("Workflow: €5k routes Director → Finance", pickRule(rules, eur5k).steps.map((s) => s.role).join(">") === "REGIONAL_DIRECTOR>FINANCE");
check("Workflow: €150k needs CEO", pickRule(rules, await toUsd(150000, "EUR")).steps.at(-1)?.role === "GLOBAL_CEO");
check("Workflow: manager cannot approve director step", !checkApprover({ status: "PENDING_APPROVAL", createdBy: "x" }, { role: "REGIONAL_DIRECTOR" }, manager!).ok);

const us = await prisma.company.findUniqueOrThrow({ where: { code: "US-MFG" } });
const exp = await prisma.financialEntry.groupBy({ by: ["period"], where: { companyId: us.id, type: "EXPENSE" }, _sum: { amountUsd: true }, orderBy: { period: "asc" } });
const anomalies = detectAnomalies(exp.map((r) => ({ period: r.period, value: Number(r._sum.amountUsd) })));
check("Anomaly: planted US October expense spike detected", anomalies.some((a) => a.period === "2026-10" && a.direction === "spike"), JSON.stringify(anomalies.map((a) => [a.period, a.zScore])));

const de = await prisma.company.findUniqueOrThrow({ where: { code: "DE-TECH" } });
const budget = await prisma.budget.findUniqueOrThrow({ where: { companyId_year: { companyId: de.id, year: 2026 } } });
check("Budget: DE budget covers a €5k PO", checkBudget(Number(budget.amountUsd), Number(budget.spentUsd), eur5k).ok, `$${Number(budget.amountUsd).toLocaleString()}`);

await prisma.$disconnect();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll integration checks passed");
process.exit(failed ? 1 : 0);
