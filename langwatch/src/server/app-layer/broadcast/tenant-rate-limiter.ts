/**
 * Per-tenant tiered rate limiter using the token-bucket algorithm.
 *
 * Each tenant gets independent buckets for "structural" events (START, END,
 * RUN_FINISHED, RUN_STARTED) and "delta" events (CONTENT, TOOL_CALL_ARGS).
 * Structural events are effectively unlimited while delta events are capped
 * at a sustained rate with burst headroom.
 */

export interface BucketConfig {
  /** Maximum tokens (burst size). */
  capacity: number;
  /** Tokens added per second. */
  refillRate: number;
}

export interface TierConfig {
  /** START, END, RUN_FINISHED, RUN_STARTED */
  structural: BucketConfig;
  /** CONTENT, TOOL_CALL_ARGS */
  delta: BucketConfig;
}

const DEFAULT_TIERS: TierConfig = {
  structural: { capacity: 200, refillRate: 200 },
  delta: { capacity: 500, refillRate: 200 },
};

interface Bucket {
  tokens: number;
  lastAccessMs: number;
}

const CLEANUP_INTERVAL_MS = 60_000;
const STALE_THRESHOLD_MS = 60_000;

export class TenantRateLimiter {
  private readonly config: TierConfig;
  private readonly buckets = new Map<string, Bucket>();
  private readonly warnedTenants = new Set<string>();
  private cleanupTimer: NodeJS.Timeout | null;

  constructor(config?: TierConfig) {
    this.config = config ?? DEFAULT_TIERS;
    this.cleanupTimer = setInterval(
      () => this.cleanupStaleBuckets(),
      CLEANUP_INTERVAL_MS,
    );
  }

  /**
   * Attempt to consume one token from the bucket for the given tenant and tier.
   *
   * @returns `true` if the event is allowed, `false` if rate-limited.
   */
  tryConsume(tenantId: string, tier: "structural" | "delta"): boolean {
    const bucketConfig = this.config[tier];
    const key = `${tenantId}:${tier}`;
    const now = Date.now();

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: bucketConfig.capacity, lastAccessMs: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsedSec = (now - bucket.lastAccessMs) / 1000;
    bucket.tokens = Math.min(
      bucketConfig.capacity,
      bucket.tokens + elapsedSec * bucketConfig.refillRate,
    );
    bucket.lastAccessMs = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    // Rate-limited — emit a single warning per tenant
    if (!this.warnedTenants.has(tenantId)) {
      this.warnedTenants.add(tenantId);
      console.warn(
        `[TenantRateLimiter] Rate limit hit for tenant "${tenantId}" on tier "${tier}"`,
      );
    }

    return false;
  }

  /** Stop the internal cleanup timer. Call on shutdown. */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  private cleanupStaleBuckets(): void {
    const now = Date.now();

    for (const [key, bucket] of this.buckets.entries()) {
      if (now - bucket.lastAccessMs >= STALE_THRESHOLD_MS) {
        this.buckets.delete(key);
      }
    }
  }
}
