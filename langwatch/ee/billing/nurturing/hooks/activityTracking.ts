import { getApp } from "../../../../src/server/app-layer/app";
import { captureException } from "../../../../src/utils/posthogErrorCapture";

const ONE_HOUR_MS = 60 * 60 * 1000;

/**
 * In-memory cache of the last time each user was identified for activity tracking.
 * Keyed by userId, value is the timestamp of the last identify call.
 *
 * NOTE: debounce is process-local. In multi-instance deployments, each instance
 * tracks independently. This is acceptable — Customer.io's 3000 req/3s limit
 * is unlikely to be hit, and duplicate identify calls are idempotent.
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
  if (now - lastSweepAt < ONE_HOUR_MS) return;
  for (const [cachedUserId, sentAt] of lastActivitySentAt) {
    if (now - sentAt >= ONE_HOUR_MS) {
      lastActivitySentAt.delete(cachedUserId);
    }
  }
  lastSweepAt = now;
}

/**
 * Pushes last_active_at to Customer.io for inactivity detection.
 *
 * Debounced to at most once per hour per user to avoid excessive API calls.
 * Fire-and-forget: never throws, never blocks the session callback.
 */
export function fireActivityTrackingNurturing({
  userId,
}: {
  userId: string;
}): void {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;

  const now = Date.now();
  sweepExpiredEntries({ now });
  const lastSent = lastActivitySentAt.get(userId);

  if (lastSent !== undefined && now - lastSent < ONE_HOUR_MS) {
    return;
  }

  lastActivitySentAt.set(userId, now);

  void nurturing
    .identifyUser({
      userId,
      traits: { last_active_at: new Date(now).toISOString() },
    })
    .catch((error) => {
      lastActivitySentAt.delete(userId);
      captureException(error);
    });
}

/**
 * Resets the debounce cache. Only exposed for testing.
 * @internal
 */
export function resetActivityTrackingCache(): void {
  lastActivitySentAt.clear();
  lastSweepAt = 0;
}

/**
 * Returns a snapshot of the cache for testing.
 * @internal
 */
export function getActivityTrackingCacheSize(): number {
  return lastActivitySentAt.size;
}
