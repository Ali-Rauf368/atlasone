# AtlasOne – Global Enterprise Intelligence Platform

A single platform for a multinational group to run its subsidiaries, with a global CEO view.
The stack is React + TypeScript + Tailwind, Node/Express, PostgreSQL, MongoDB, Redis, Socket.IO, Apache NiFi, Google Workspace LDAP, OpenTelemetry, Jest + Playwright, Docker and GitHub Actions.

```
 Browser (React) ──HTTP/WebSocket──► Express API (modular monolith)
                                       ├─ auth ─────► LDAP (Google Secure LDAP / OpenLDAP)
                                       ├─ org, finance, hr, scm, crm, reports, purchase orders
                                       ├─ Prisma ───► PostgreSQL   transactional data
                                       ├─ Mongoose ─► MongoDB      audit trail
                                       ├─ ioredis ──► Redis        dashboard cache
                                       ├─ Socket.IO               live notifications (per role and user)
                                       └─ OTel ─────► Jaeger       traces
 Apache NiFi ──x-api-key──► /api/ingest/*   (CSV financials, FX rates)
```

## Modules
| Module | What it contains |
|---|---|
| Organization | Interactive hierarchy tree (holding → subsidiaries → departments, with headcounts), adding subsidiaries and departments, **country-specific configuration** (timezone, locale, fiscal-year start, VAT, payroll cycle, data residency) |
| Finance | FX rate management (moves over 20% need confirmation), manual journal entries, ledger with source filters, editable budgets (never below committed spend), P&L with CSV export |
| HR | Paginated, searchable global employee directory; onboarding status; leave requests with approval; attendance rate; payroll per subsidiary; job openings; performance ratings |
| Supply chain | Suppliers, warehouses, stock with low-stock alerts, shipments created automatically from approved POs |
| CRM | Customer database, Kanban sales pipeline, contracts with expiry, sales performance and win rate |
| Intelligence | CEO dashboard (KPIs, country filter, subsidiary comparison, underperformer flag), least-squares revenue forecast, **custom report builder** (8 metrics × company/country/region/month, chart and CSV), **robust anomaly detection** (median/MAD z-score) with an hourly background scan |
| Security | **Security center**: logins and failures per hour, brute-force detection, **account lockout** (5 failures in 15 min), revocable sessions (logout), risky and off-hours events, role × permission matrix |
| Governance | LDAP login, role-based permissions, **row-level data scoping**, **configurable approval engine**, **tamper-evident audit log**, persisted and live notifications |

## Advanced capabilities
| Capability | How it works | Where |
|---|---|---|
| **Approval rule engine** | Approval chains are stored in Postgres and chosen by the PO's USD amount: < $5k Finance only; $5k–$100k Director → Finance; ≥ $100k Director → Finance → **CEO**. The CEO edits them in the UI, the server validates contiguous bands and requires a budget-check step, and every change is audited. In-flight POs keep the chain they started with. | `lib/workflow.ts`, `/workflow` |
| **SLA escalation** | Each step has an SLA. A delayed BullMQ job checks the step at its deadline; if it is still open, the step is marked escalated and the approver and CEO are notified. | `lib/jobs.ts` |
| **Concurrency safety** | A step is claimed with a conditional update (`currentStep` + status), so two approvers can't both decide it (409). Budget is *reserved* at the finance step inside the same transaction and released on later rejection. | `routes/purchaseOrders.ts` |
| **Row-level data scoping** | CEO and group Finance see everything. A regional director sees only their region (LDAP `ou`), other users only their company (LDAP `departmentNumber`). Applied to every list, create and decide endpoint. | `lib/scope.ts` |
| **Tamper-evident audit** | Each audit entry stores `sha256(prevHash + entry)`. *Verify integrity* re-walks the chain and pinpoints the first altered or deleted record. | `models/audit.ts` |
| **Anomaly detection** | Uses a modified z-score (median/MAD), so large outliers don't hide themselves. A spike is planted in US manufacturing, October. | `lib/anomaly.ts` |
| **Persistent notifications** | Stored in MongoDB and pushed over Socket.IO, so users see what they missed on their next login. | `lib/notify.ts` |
| **API docs** | OpenAPI 3.1 with Swagger UI at `/api/docs`. | `openapi.ts` |
| **Hardening** | Helmet headers, rate limiting (20 logins per 15 min), LDAP filter escaping, request IDs, no stack traces in responses, CORS allow-list, graceful shutdown. | `app.ts` |

## Run it
```bash
# Option A: everything in Docker
docker compose --profile app up -d --build
cd api && npm ci && npx prisma generate && npm run db:seed          # one-off demo data
open http://localhost:8081

# Option B: dev mode
docker compose up -d
cd api && npm i && npx prisma db push && npm run db:seed && npm run dev
cd web && npm i && npm run dev                                       # http://localhost:5173
```
Demo users (password `password`): **ceo** · **director** (Europe) · **director.asia** (Asia) · **manager** (DE-TECH) · **manager.pk** (PK-PHARMA) · **finance**. All figures are illustrative.

> If you already started the LDAP container before this version, recreate it so the new users load: `docker compose up -d --force-recreate ldap`.
> The PO status enum changed, so on an existing database run `npx prisma db push --accept-data-loss && npm run db:seed`.

| URL | Service |
|---|---|
| :8081 / :5173 | AtlasOne web app |
| :4000/health | API |
| :8080/nifi | Apache NiFi (flows: `infra/nifi/README.md`) |
| :16686 | Jaeger traces |

## Demo script
1. **ceo**: open the dashboard and switch between Germany and Pakistan. Pakistan is flagged as underperforming. Open Reports for the P&L, forecast and CSV export.
2. **manager**: create a €5,000 PO for AtlasOne Technology GmbH. The director receives a live notification.
3. **director**: the order is waiting under *My approvals*. Approve it and Finance is notified. **director.asia** never sees it (scoping).
4. **finance**: approve it. Inside one transaction the budget is checked and committed, an expense is booked and a shipment is created.
5. **manager**: create a €150,000 PO. It routes Director → Finance → **CEO**. If a step passes its SLA, it escalates automatically.
6. **ceo**: approve it, then open *Workflow rules* to change the thresholds. On the audit log, click *Verify integrity*.
7. Supply chain shows the new shipment. The audit log shows every step. The CEO dashboard shows the new expense, and the CEO receives a "Procurement committed" toast.

## Tests
```bash
cd api && npm test               # unit + HTTP tests (workflow, RBAC, forecast, auth), no DB required
cd e2e && npm i && npx playwright install chromium && npx playwright test   # needs a running, seeded stack
```
CI (`.github/workflows/ci.yml`) runs typechecks, unit tests and the build, then starts the stack and runs Playwright. On `main` it pushes images to GHCR.

## Google Workspace Secure LDAP
1. Admin console → Apps → LDAP → **Add client**. Allow verifying user credentials and reading users and groups.
2. Download the certificate and key, then in `api/.env` set:
   `LDAP_URL=ldaps://ldap.google.com:636`, `LDAP_BASE_DN=dc=yourdomain,dc=com`, `LDAP_TLS_CERT=…`, `LDAP_TLS_KEY=…`, and leave `LDAP_BIND_DN` empty.
3. Create Google Groups named `GLOBAL_CEO`, `REGIONAL_DIRECTOR`, `DEPARTMENT_MANAGER`, `FINANCE`, `COMPANY_ADMIN` and `SUPER_ADMIN`.

## Development without Docker
```bash
cd api
npm run dev:ldap                 # LDAP on :3890, serving infra/ldap/seed.ldif
npm run dev:mongo -- 27017       # in-memory MongoDB (needs a CPU with AVX; otherwise MONGOMS_VERSION=4.4.29 plus libssl1.1)
# Postgres: any local instance, e.g. DATABASE_URL=postgresql://atlas@localhost:5432/atlasone
LDAP_URL=ldap://127.0.0.1:3890 npm run dev
npm run verify:integration       # 18 checks against real Postgres + LDAP
```

> **MongoDB and AVX:** MongoDB 5 and later need a CPU with AVX. On older CPUs, run `MONGO_IMAGE=mongo:4.4 docker compose up -d`.

## Verification status
| Check | Result |
|---|---|
| API typecheck, web typecheck and production build | ✅ |
| Unit and HTTP tests (`npm test`) | ✅ 36/36: workflow, RBAC, scoping rules, anomaly detection, hash chain, auth hardening, permissions |
| Schema and seed on real PostgreSQL 16 | ✅ 6 companies, 210 employees, 4,200 attendance rows, 3 workflow rules, 5 country configs |
| Integration on real Postgres + LDAP (`verify:integration`) | ✅ 18/18: LDAP login and roles, region and company attributes, filter-injection rejection, row scoping, rule routing, FX, budget, anomaly detection |
| Full stack running locally (Postgres 16, MongoDB 4.4, LDAP, API, web) | ✅ |
| Live API smoke test (`node api/scripts/smoke.mjs`) | ✅ 33/33, passes on repeat runs: demo scenario, Socket.IO push, simultaneous-approval race (200/409), budget reserve and release, scoping, NiFi ingest, lockout, logout revocation, Swagger |
| Browser tests (Playwright, Chromium) | ✅ 5/5: CEO dashboard, standard and strategic PO flows through the UI, hash-chain verification, scoping, menu restrictions |
| Not exercised locally | Redis/BullMQ (in-process fallback was used), NiFi UI flows (ingest endpoint was tested directly), OpenTelemetry export, Docker images |
