import http from "node:http";
import mongoose from "mongoose";
import { env } from "./lib/env.js";
import { app } from "./app.js";
import { initRealtime } from "./lib/realtime.js";
import { startJobs } from "./lib/jobs.js";
import { prisma } from "./lib/db.js";

await mongoose.connect(env.mongoUrl);
const server = http.createServer(app);
initRealtime(server);
await startJobs();
server.listen(env.port, () => console.log(`AtlasOne API on :${env.port} · docs at /api/docs`));

// Graceful shutdown for containers / rolling deploys
for (const sig of ["SIGTERM", "SIGINT"] as const)
  process.on(sig, () => {
    server.close(async () => { await prisma.$disconnect(); await mongoose.disconnect(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  });
