import { connection } from "../redis";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("langwatch:middleware:rate-limit-langy");

export const LANGY_MESSAGES_PER_MINUTE = 30;
export const LANGY_TOOL_CALLS_PER_MESSAGE = 8;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
};

// Logged at most once per process — a sustained Redis outage would otherwise
// flood logs with one line per chat message.
let redisDownWarned = false;

/**
 * Sliding-window-ish rate limit using Redis INCR + EXPIRE on a per-minute key.
 * Fails open when Redis is unavailable (so dev/test stay usable and a brief
 * Redis blip doesn't 500 the chat endpoint), but logs a warning so the outage
 * is visible in the platform's logs.
 */
export async function checkLangyMessageRateLimit({
  userId,
  projectId,
  limit = LANGY_MESSAGES_PER_MINUTE,
}: {
  userId: string;
  projectId: string;
  limit?: number;
}): Promise<RateLimitResult> {
  if (!connection) {
    if (!redisDownWarned) {
      redisDownWarned = true;
      logger.warn(
        "Redis unavailable — Langy chat rate limit is disabled until it returns. Subsequent requests will not be re-logged until the process restarts.",
      );
    }
    return { allowed: true, remaining: limit };
  }
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `langy:rl:msg:${projectId}:${userId}:${bucket}`;
  const count = await (connection as { incr: (k: string) => Promise<number> }).incr(key);
  if (count === 1) {
    await (
      connection as { expire: (k: string, s: number) => Promise<number> }
    ).expire(key, 65);
  }
  const remaining = Math.max(0, limit - count);
  if (count > limit) {
    const nextBucket = (bucket + 1) * 60_000;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((nextBucket - Date.now()) / 1000)),
    };
  }
  return { allowed: true, remaining };
}
