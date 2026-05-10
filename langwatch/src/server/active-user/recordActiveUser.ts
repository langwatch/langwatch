import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import { trackServerEvent } from "../posthog";
import type { ClientSource } from "./parseClientSource";

const logger = createLogger("langwatch:active-user");

const KEY_PREFIX = "active_user:";

// 48h — long enough that a request near UTC midnight in the user's tz
// still finds yesterday's key, short enough that the dedup pool stays
// bounded if the user is genuinely active every day.
const TTL_SECONDS = 172_800;

function buildKey(userId: string, day: string, source: string): string {
  return `${KEY_PREFIX}${userId}:${day}:${source}`;
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export interface RecordActiveUserDeps {
  redis: IORedis | Cluster | undefined;
  trackEvent?: typeof trackServerEvent;
  now?: () => Date;
}

export interface RecordActiveUserInput {
  userId: string;
  source: ClientSource;
  version?: string;
}

/**
 * Heartbeat capture for the `api_active_user` PostHog metric.
 *
 * Deduped per `(userId, UTC day, source)` via Redis `SET NX` so a power user
 * making thousands of API calls produces at most one event per source per day.
 *
 * Fire-and-forget contract: never throws, never blocks the caller. On Redis
 * outage we fire the event anyway (graceful overcount beats a silent gap).
 * If `POSTHOG_KEY` isn't set, `trackServerEvent` no-ops.
 */
export async function recordActiveUser(
  input: RecordActiveUserInput,
  deps: RecordActiveUserDeps,
): Promise<void> {
  const { userId, source, version } = input;
  const {
    redis,
    trackEvent = trackServerEvent,
    now = () => new Date(),
  } = deps;

  let isFirstToday = true;
  if (redis) {
    try {
      const result = await redis.set(
        buildKey(userId, utcDay(now()), source),
        "1",
        "EX",
        TTL_SECONDS,
        "NX",
      );
      isFirstToday = result === "OK";
    } catch (error) {
      logger.warn(
        { error, userId, source },
        "active-user dedup unavailable; firing api_active_user as graceful overcount",
      );
      isFirstToday = true;
    }
  }

  if (!isFirstToday) return;

  trackEvent({
    userId,
    event: "api_active_user",
    properties: { source, ...(version ? { version } : {}) },
  });
}
