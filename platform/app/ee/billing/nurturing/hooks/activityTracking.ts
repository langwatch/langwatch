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
 * Last time the app_active event was sent for each user. Kept apart from the
 * identify cache: a failed identify clears its own entry to retry, and that
 * retry must not send a second event within the hour.
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
  if (now - lastSweepAt < ONE_HOUR_MS) return;
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
 * Pushes last_active_at to Customer.io for inactivity detection, and tracks
 * an app_active event for campaign conversion goals.
 *
 * Debounced to at most once per hour per user to avoid excessive API calls.
 * Fire-and-forget: never throws, never blocks the session callback.
 */
export function fireActivityTrackingNurturing({
  userId,
  hasOrganization = true,
}: {
  userId: string;
  /** When false, the user hasn't completed onboarding yet — skip identify to avoid ghost people in Customer.io. */
  hasOrganization?: boolean;
}): void {
  const nurturing = getApp().nurturing;
  if (!nurturing) return;
  if (!hasOrganization) return;

  const now = Date.now();
  sweepExpiredEntries({ now });
  trackAppActive({ nurturing, userId, now });

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
 * Tracks app_active at most once per hour per user. A failed track is
 * reported and not retried within the hour.
 */
function trackAppActive({
  nurturing,
  userId,
  now,
}: {
  nurturing: NonNullable<ReturnType<typeof getApp>["nurturing"]>;
  userId: string;
  now: number;
}): void {
  const lastSent = lastAppActiveSentAt.get(userId);
  if (lastSent !== undefined && now - lastSent < ONE_HOUR_MS) return;

  lastAppActiveSentAt.set(userId, now);

  void nurturing
    .trackEvent({ userId, event: "app_active" })
    .catch(captureException);
}

/**
 * Resets the debounce cache. Only exposed for testing.
 * @internal
 */
export function resetActivityTrackingCache(): void {
  lastActivitySentAt.clear();
  lastAppActiveSentAt.clear();
  lastSweepAt = 0;
}

/**
 * Returns a snapshot of the cache for testing.
 * @internal
 */
export function getActivityTrackingCacheSize(): number {
  return lastActivitySentAt.size;
}
