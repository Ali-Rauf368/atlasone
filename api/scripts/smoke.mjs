// End-to-end smoke test of the running API (the demo scenario). Usage: node scripts/smoke.mjs [baseUrl]
import { io } from "../../web/node_modules/socket.io-client/build/esm-debug/index.js";
const BASE = process.argv[2] ?? "http://localhost:4000";
let failed = 0;
const check = (name, ok, info = "") => { console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? `  (${info})` : ""}`); if (!ok) failed++; };

async function call(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", ...(token && { Authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: r.status, body: json };
}
const login = async (u) => (await call(null, "POST", "/api/auth/login", { username: u, password: "password" })).body.token;

const t = Object.fromEntries(await Promise.all(["ceo", "director", "director.asia", "manager", "manager.pk", "finance"].map(async (u) => [u, await login(u)])));
check("Login: all 6 directory users get a token", Object.values(t).every(Boolean));

// Live notification channel: the director should be pushed the new PO
const pushed = [];
const sock = io(BASE, { auth: { token: t.director }, transports: ["websocket"] });
await new Promise((res) => sock.on("connect", res));
sock.on("notification", (n) => pushed.push(n));

const dash = await call(t.ceo, "GET", "/api/dashboard/global");
check("CEO dashboard", dash.status === 200 && dash.body.kpis.subsidiaries === 5, `revenue $${Math.round(dash.body.kpis?.revenue).toLocaleString()}, ${dash.body.kpis?.employees} employees`);
check("Dashboard forbidden for manager", (await call(t.manager, "GET", "/api/dashboard/global")).status === 403);

const companies = (await call(t.manager, "GET", "/api/dashboard/companies")).body;
check("Manager scope = DE only", companies.length === 1 && companies[0].code === "DE-TECH");
const de = companies[0];
// Make the run repeatable: finance tops up DE's annual budget (the API refuses to go below committed spend)
const committed = (await call(t.finance, "GET", "/api/reports/budgets")).body.find((b) => b.companyId === de.id).spentUsd;
check("Finance sets DE budget", (await call(t.finance, "PUT", `/api/finance/budgets/${de.id}/2026`, { amountUsd: committed + 1_000_000 })).status === 200);

// Standard PO €5k: director → finance
const po = await call(t.manager, "POST", "/api/purchase-orders", { companyId: de.id, supplier: "Siemens Supply Hub", description: "Laptops", amount: 5000 });
check("Manager creates €5k PO", po.status === 201 && po.body.steps.length === 2, po.body.ruleName);
await new Promise((r) => setTimeout(r, 500));
check("Director got live Socket.IO push", pushed.some((n) => n.body?.includes(po.body.number)), `${pushed.length} pushed`);

check("Asia director cannot see EU PO", (await call(t["director.asia"], "POST", `/api/purchase-orders/${po.body.id}/decision`, { decision: "APPROVE" })).status === 404);
check("Finance cannot skip director step", (await call(t.finance, "POST", `/api/purchase-orders/${po.body.id}/decision`, { decision: "APPROVE" })).status === 403);
const inbox = (await call(t.director, "GET", "/api/purchase-orders/inbox")).body;
check("PO is in director's inbox", inbox.some((p) => p.id === po.body.id));

const [a1, a1dup] = await Promise.all([
  call(t.director, "POST", `/api/purchase-orders/${po.body.id}/decision`, { decision: "APPROVE", comment: "ok" }),
  call(t.director, "POST", `/api/purchase-orders/${po.body.id}/decision`, { decision: "APPROVE" }),
]);
check("Concurrent double-approval: exactly one wins", [a1.status, a1dup.status].sort().join() === "200,409", `${a1.status}/${a1dup.status}`);
const budgetBefore = (await call(t.finance, "GET", "/api/reports/budgets")).body.find((b) => b.companyId === de.id).spentUsd;
const a2 = await call(t.finance, "POST", `/api/purchase-orders/${po.body.id}/decision`, { decision: "APPROVE" });
check("Finance approval → sent to supplier", a2.body.status === "SENT_TO_SUPPLIER");
const budgetAfter = (await call(t.finance, "GET", "/api/reports/budgets")).body.find((b) => b.companyId === de.id).spentUsd;
check("Budget committed by $5,400", Math.round(budgetAfter - budgetBefore) === 5400, `${budgetBefore} → ${budgetAfter}`);
const ship = (await call(t.manager, "GET", "/api/scm/shipments")).body;
check("Shipment auto-created", ship.some((s) => s.poNumber === po.body.number));

// Strategic PO needs CEO
const big = await call(t.manager, "POST", "/api/purchase-orders", { companyId: de.id, supplier: "Pacific Components", description: "Production line", amount: 150000 });
check("€150k PO gets 3-step chain ending at CEO", big.body.steps?.at(-1)?.role === "GLOBAL_CEO", big.body.ruleName);
await call(t.director, "POST", `/api/purchase-orders/${big.body.id}/decision`, { decision: "APPROVE" });
await call(t.finance, "POST", `/api/purchase-orders/${big.body.id}/decision`, { decision: "APPROVE" });
const rej = await call(t.ceo, "POST", `/api/purchase-orders/${big.body.id}/decision`, { decision: "REJECT" });
check("Reject without comment refused", rej.status === 400);
const spentMid = (await call(t.finance, "GET", "/api/reports/budgets")).body.find((b) => b.companyId === de.id).spentUsd;
const rej2 = await call(t.ceo, "POST", `/api/purchase-orders/${big.body.id}/decision`, { decision: "REJECT", comment: "Defer to Q1" });
const spentEnd = (await call(t.finance, "GET", "/api/reports/budgets")).body.find((b) => b.companyId === de.id).spentUsd;
check("CEO rejection releases reserved budget", rej2.body.status === "REJECTED" && Math.round(spentMid - spentEnd) === 162000, `${spentMid} → ${spentEnd}`);

// Audit + integrity
const audit = (await call(t.ceo, "GET", "/api/audit")).body;
check("Audit trail recorded the flow", ["PO_CREATED", "PO_STEP_APPROVED", "PO_SENT_TO_SUPPLIER", "PO_REJECTED"].every((a) => audit.some((e) => e.action === a)), `${audit.length} entries`);
const v = (await call(t.ceo, "GET", "/api/audit/verify")).body;
check("Audit hash chain intact", v.ok === true, `${v.checked} verified`);

// Other modules
check("Anomaly endpoint finds US Oct spike", (await call(t.ceo, "GET", "/api/reports/anomalies")).body.some((a) => a.company.includes("Manufacturing") && a.period === "2026-10"));
const rep = await call(t.ceo, "POST", "/api/reports/custom", { metric: "profit", groupBy: "country" });
check("Custom report builder", rep.status === 200 && rep.body.rows.length === 5, rep.body.rows?.map((r) => r.group).join(", "));
check("Forecast", (await call(t.ceo, "GET", "/api/reports/forecast?months=3")).body.forecast?.length === 3);
check("HR directory scoped to DE", (await call(t.manager, "GET", "/api/hr/employees")).body.total === 40);
check("CRM pipeline", (await call(t.director, "GET", "/api/crm/pipeline")).body.length === 5);
check("Org tree", (await call(t.ceo, "GET", "/api/org/tree")).body[0]?.children.length === 5);
check("Country config", (await call(t.ceo, "GET", "/api/org/countries")).body.every((c) => c.config));
check("FX big move needs confirm", (await call(t.finance, "PUT", "/api/finance/fx/EUR", { toUsd: 2 })).status === 409);
check("NiFi ingest with API key", (await (await fetch(BASE + "/api/ingest/financials", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": "nifi-dev-key" },
  body: JSON.stringify([{ companyCode: "DE-TECH", period: "2026-11", type: "REVENUE", category: "NiFi test", amount: 1000, currency: "EUR" }]) })).json()).inserted === 1);
check("Persisted notifications for director", (await call(t.director, "GET", "/api/notifications")).body.length > 0);
check("Swagger docs served", (await fetch(BASE + "/api/docs/")).status === 200);

// Security: lockout + logout revocation
for (let i = 0; i < 5; i++) await call(null, "POST", "/api/auth/login", { username: "lockout.probe", password: "wrong" });
check("Account locks after 5 failures", (await call(null, "POST", "/api/auth/login", { username: "lockout.probe", password: "whatever" })).status === 423);
const sec = (await call(t.ceo, "GET", "/api/security/overview")).body;
check("Security center sees the attack", sec.suspiciousAccounts?.some((a) => a.username === "lockout.probe" && a.locked));
await call(t.manager, "POST", "/api/auth/logout");
check("Token revoked after logout", (await call(t.manager, "GET", "/api/purchase-orders")).status === 401);

sock.close();
console.log(failed ? `\n${failed} check(s) FAILED` : "\nAll smoke checks passed");
process.exit(failed ? 1 : 0);
