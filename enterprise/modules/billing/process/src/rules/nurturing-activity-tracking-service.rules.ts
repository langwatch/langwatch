import { nowInstant, Temporal } from "@langwatch/time";

import { findSink, reportFailure } from "./nurturing-sink-registry-service.rules.ts";

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * In-memory cache of the last time each user was identified for activity tracking. Keyed
 * by userId, value is the timestamp of the last identify call.
 */
const lastActivitySentAt = new Map<string, number>();

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

  for (const [cachedUserId, sentAt] of lastActivitySentAt) {
    if (now - sentAt >= ONE_HOUR_MS) {
      lastActivitySentAt.delete(cachedUserId);
    }
  }

  lastSweepAt = now;
}

/** Pushes last_active_at to Customer.io for inactivity detection. */
export function fire({
  userId,
  hasOrganization = true,
}: {
  userId: string;
  /** False when onboarding incomplete; skips identify to avoid ghosts. */
  hasOrganization?: boolean;
}): void {
  const nurturing = findSink();
  if (!nurturing) {
    return;
  }

  if (!hasOrganization) {
    return;
  }

  const now = nowInstant().epochMilliseconds;
  sweepExpiredEntries({ now });
  const lastSent = lastActivitySentAt.get(userId);

  if (lastSent !== undefined && now - lastSent < ONE_HOUR_MS) {
    return;
  }

  lastActivitySentAt.set(userId, now);

  void nurturing
    .identifyUser({
      userId,
      traits: {
        last_active_at: Temporal.Instant.fromEpochMilliseconds(now).toString({
          fractionalSecondDigits: 3,
        }),
      },
    })
    .catch((error) => {
      lastActivitySentAt.delete(userId);
      reportFailure(error);
    });
}

/**
 * Resets the debounce cache. Only exposed for testing.
 * @internal
 */
export function resetCache(): void {
  lastActivitySentAt.clear();
  lastSweepAt = 0;
}

/**
 * Returns a snapshot of the cache for testing.
 * @internal
 */
export function cacheSize(): number {
  return lastActivitySentAt.size;
}
