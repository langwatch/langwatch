import { connection } from "../redis";

export const LANGY_MESSAGES_PER_MINUTE = 30;
export const LANGY_TOOL_CALLS_PER_MESSAGE = 8;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
};

/**
 * Sliding-window-ish rate limit using Redis INCR + EXPIRE on a per-minute key.
 * No-ops (always allows) when Redis is unavailable to keep dev/test usable.
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
