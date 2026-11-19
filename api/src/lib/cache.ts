import { Redis } from "ioredis";
import { env } from "./env.js";

// Redis is optional: without REDIS_URL the cache is a no-op.
const redis = env.redisUrl ? new Redis(env.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 }) : null;
redis?.on("error", (e) => console.warn("redis:", e.message));

export async function cached<T>(key: string, ttlSec: number, fn: () => Promise<T>): Promise<T> {
  if (redis) {
    try { const hit = await redis.get(key); if (hit) return JSON.parse(hit) as T; } catch { /* fall through */ }
  }
  const value = await fn();
  redis?.set(key, JSON.stringify(value), "EX", ttlSec).catch(() => {});
  return value;
}
export async function invalidate(...keys: string[]) { if (redis && keys.length) await redis.del(...keys).catch(() => {}); }
