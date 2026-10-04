import type { CioBatchCall } from "@langwatch/enterprise-nurturing-contract";
import { nowInstant, Temporal } from "@langwatch/time";

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * In-memory cache of the last time each user was identified for activity tracking. Keyed
 * by userId, value is the timestamp of the last identify call.
 */
const lastActivitySentAt = new Map<string, number>();

/**
 * Last time the app_active event was decided for each user. Kept apart from the identify
 * cache, so the event has its own hourly limit whatever becomes of the identify.
 */
const lastAppActiveSentAt = new Map<string, number>();

/**
 * Timestamp of the last sweep pass. Sweeps run at most once per hour
 * to avoid O(n) iteration overhead on every call.
 */
let lastSweepAt = 0;

/**
 * Evicts entries older than ONE_HOUR_MS from the debounce cache.
 * Only runs at most once per hour to keep per-call cost constant.
 */
function sweepExpiredEntries({ now }: { now: number }): void {
  if (now - lastSweepAt < ONE_HOUR_MS) {
    return;
  }

  for (const cache of [lastActivitySentAt, lastAppActiveSentAt]) {
    for (const [cachedUserId, sentAt] of cache) {
      if (now - sentAt >= ONE_HOUR_MS) {
        cache.delete(cachedUserId);
      }
    }
  }

  lastSweepAt = now;
}

/**
 * Decides whether a session pushes last_active_at to Customer.io and tracks app_active, the
 * event campaign conversion goals count. Each is debounced to once per hour per user, on
 * its own cache.
 */
export function fire({
  userId,
  hasOrganization = true,
}: {
  userId: string;
  /** False when onboarding incomplete; skips identify to avoid ghosts. */
  hasOrganization?: boolean;
}): CioBatchCall[] {
  if (!hasOrganization) {
    return [];
  }

  const now = nowInstant().epochMilliseconds;
  sweepExpiredEntries({ now });

  return [...identifyLastActive({ userId, now }), ...trackAppActive({ userId, now })];
}

/** The last_active_at identify, at most once per hour per user. */
function identifyLastActive({ userId, now }: { userId: string; now: number }): CioBatchCall[] {
  const lastSent = lastActivitySentAt.get(userId);
  if (lastSent !== undefined && now - lastSent < ONE_HOUR_MS) {
    return [];
  }

  lastActivitySentAt.set(userId, now);

  return [
    {
      type: "identify",
      userId,
      traits: {
        last_active_at: Temporal.Instant.fromEpochMilliseconds(now).toString({
          fractionalSecondDigits: 3,
        }),
      },
    },
  ];
}

/** The app_active event, at most once per hour per user. */
function trackAppActive({ userId, now }: { userId: string; now: number }): CioBatchCall[] {
  const lastSent = lastAppActiveSentAt.get(userId);
  if (lastSent !== undefined && now - lastSent < ONE_HOUR_MS) {
    return [];
  }

  lastAppActiveSentAt.set(userId, now);

  return [{ type: "track", userId, event: "app_active" }];
}

/**
 * Resets the debounce cache. Only exposed for testing.
 * @internal
 */
export function resetCache(): void {
  lastActivitySentAt.clear();
  lastAppActiveSentAt.clear();
  lastSweepAt = 0;
}

/**
 * Returns a snapshot of the cache for testing.
 * @internal
 */
export function cacheSize(): number {
  return lastActivitySentAt.size;
}

/**
 * Returns the size of the app_active debounce cache for testing.
 * @internal
 */
export function appActiveCacheSize(): number {
  return lastAppActiveSentAt.size;
}
