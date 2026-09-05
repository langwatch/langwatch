import { reportNurturingFailure, tryNurturingSink } from "./nurturing-sink";

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

export class NurturingActivityTrackingService {
  static create(): NurturingActivityTrackingService {
    return new NurturingActivityTrackingService();
  }

  /**
   * Pushes last_active_at to Customer.io for inactivity detection.
   */
  static fire({
    userId,
    hasOrganization = true,
  }: {
    userId: string;
    /** When false, the user hasn't completed onboarding yet — skip identify to avoid ghost people in Customer.io. */
    hasOrganization?: boolean;
  }): void {
    const nurturing = tryNurturingSink();
    if (!nurturing) {
      return;
    }

    if (!hasOrganization) {
      return;
    }

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
        reportNurturingFailure(error);
      });
  }

  /**
   * Resets the debounce cache. Only exposed for testing.
   * @internal
   */
  static resetCache(): void {
    lastActivitySentAt.clear();
    lastSweepAt = 0;
  }

  /**
   * Returns a snapshot of the cache for testing.
   * @internal
   */
  static cacheSize(): number {
    return lastActivitySentAt.size;
  }
}
