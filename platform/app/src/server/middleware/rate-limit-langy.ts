import { createLogger } from "@langwatch/observability";

import { getLangyRateLimitCounter } from "~/server/metrics";
import { tryGetApp } from "../app-layer/app";

const logger = createLogger("langwatch:langy:rate-limit");

export const LANGY_MESSAGES_PER_MINUTE = 30;

/**
 * The warm budget, deliberately looser than the message budget: a panel open,
 * a conversation switch and a model switch each warm, so normal use fires
 * several warms per minute without a single message. It is still bounded,
 * because every warm with no conversation id mints a conversation, mints a
 * session key and asks for a worker.
 */
export const LANGY_WARMS_PER_MINUTE = 60;

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds?: number;
};

/**
 * Sliding-window-ish rate limit using Redis INCR + EXPIRE on a per-minute key.
 * No-ops (always allows) when Redis is unavailable to keep dev/test usable.
 */
export async function checkLangyMessageRateLimit(params: {
  userId: string;
  projectId: string;
  limit?: number;
}): Promise<RateLimitResult> {
  return checkPerMinuteLimit({
    userId: params.userId,
    projectId: params.projectId,
    keyPrefix: "langy:rl:msg",
    limit: params.limit ?? LANGY_MESSAGES_PER_MINUTE,
  });
}

/**
 * The same per-minute counter for panel-open warms, on its own key namespace
 * and its own budget. A warm deliberately skips `langyTurnProcedure` so a
 * panel open never spends the message budget, but "not the message budget" is
 * not "no budget": without this a loop over the mutation mints conversations,
 * mints session keys and spawns workers at the caller's request rate.
 */
export async function checkLangyWarmRateLimit(params: {
  userId: string;
  projectId: string;
  limit?: number;
}): Promise<RateLimitResult> {
  return checkPerMinuteLimit({
    userId: params.userId,
    projectId: params.projectId,
    keyPrefix: "langy:rl:warm",
    limit: params.limit ?? LANGY_WARMS_PER_MINUTE,
  });
}

async function checkPerMinuteLimit({
  userId,
  projectId,
  limit,
  keyPrefix,
}: {
  userId: string;
  projectId: string;
  limit: number;
  keyPrefix: string;
}): Promise<RateLimitResult> {
  const connection = tryGetApp()?.redis ?? null;
  if (!connection) {
    return { allowed: true, remaining: limit };
  }
  const bucket = Math.floor(Date.now() / 60_000);
  const key = `${keyPrefix}:${projectId}:${userId}:${bucket}`;
  let count: number;
  try {
    count = await (connection as { incr: (k: string) => Promise<number> }).incr(key);
    if (count === 1) {
      await (connection as { expire: (k: string, s: number) => Promise<number> }).expire(
        key,
        65,
      );
    }
  } catch (error) {
    // Redis hiccup — fail open rather than 500 the chat request, matching the
    // no-connection branch above. Metered + logged: a sustained fail_open rate
    // means the limit is effectively off fleet-wide (Redis outage).
    getLangyRateLimitCounter("fail_open").inc();
    logger.warn(
      { error, projectId, userId },
      "langy rate limit failing open on redis error",
    );
    return { allowed: true, remaining: limit };
  }
  const remaining = Math.max(0, limit - count);
  if (count > limit) {
    getLangyRateLimitCounter("rejected").inc();
    const nextBucket = (bucket + 1) * 60_000;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((nextBucket - Date.now()) / 1000)),
    };
  }
  return { allowed: true, remaining };
}
