import "express-async-errors"; // Express 4: forward async handler rejections to the error middleware
import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import crypto from "node:crypto";
import { env } from "./lib/env.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { poRouter } from "./routes/purchaseOrders.js";
import { auditRouter } from "./routes/audit.js";
import { ingestRouter } from "./routes/ingest.js";
import { hrRouter } from "./routes/hr.js";
import { scmRouter } from "./routes/scm.js";
import { crmRouter } from "./routes/crm.js";
import { reportsRouter } from "./routes/reports.js";
import { governanceRouter } from "./routes/governance.js";
import { openapi } from "./openapi.js";
import { orgRouter } from "./routes/org.js";
import { financeRouter } from "./routes/finance.js";
import { securityRouter } from "./routes/security.js";

export const app = express();
app.set("trust proxy", 1);
app.disable("x-powered-by");

// Swagger UI needs inline scripts, so mount it before the strict CSP
app.get("/api/openapi.json", (_req, res) => res.json(openapi));
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: "AtlasOne API" }));

app.use(helmet());
app.use(cors({ origin: env.corsOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/ingest", express.json({ limit: "20mb" }));

// Correlation id for logs and traces
app.use((req, res, next) => {
  const id = req.header("x-request-id") ?? crypto.randomUUID();
  res.setHeader("x-request-id", id);
  next();
});

const limiter = (windowMs: number, limit: number) => rateLimit({ windowMs, limit, standardHeaders: "draft-7", legacyHeaders: false, message: { error: "Too many requests" } });

app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth/login", limiter(15 * 60_000, Number(process.env.LOGIN_RATE_LIMIT ?? 20)));   // brute-force protection on directory logins
app.use("/api", limiter(60_000, 600));
app.use("/api/auth", authRouter);
app.use("/api/ingest", ingestRouter);
app.use("/api/dashboard", requireAuth, dashboardRouter);
app.use("/api/purchase-orders", requireAuth, poRouter);
app.use("/api/audit", requireAuth, auditRouter);
app.use("/api/hr", requireAuth, hrRouter);
app.use("/api/scm", requireAuth, scmRouter);
app.use("/api/crm", requireAuth, crmRouter);
app.use("/api/reports", requireAuth, reportsRouter);
app.use("/api/org", requireAuth, orgRouter);
app.use("/api/finance", requireAuth, financeRouter);
app.use("/api/security", requireAuth, securityRouter);
app.use("/api", requireAuth, governanceRouter);

app.use((err: Error & { status?: number; code?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = err.name === "ZodError" ? 400 : err.code === "P2025" ? 404 : err.code === "P2002" ? 409 : err.status ?? 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.name === "ZodError" ? JSON.parse(err.message) : status === 500 ? "Internal error" : err.message });
});
