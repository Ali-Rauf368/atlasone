// In-memory MongoDB for local development/tests without Docker. Usage: node scripts/dev-mongo.mjs [port=27017]
import { MongoMemoryServer } from "mongodb-memory-server";
const port = Number(process.argv[2] ?? 27017);
const m = await MongoMemoryServer.create({ instance: { port, ip: "127.0.0.1" } });
console.log(`dev MongoDB on ${m.getUri()}`);
process.on("SIGTERM", async () => { await m.stop(); process.exit(0); });
process.on("SIGINT", async () => { await m.stop(); process.exit(0); });
