import { nowInstant } from "@langwatch/time";

import {
  WebhookDispatchRateLimiter,
  type WebhookDispatchRateLimitResult,
} from "./webhook-dispatch-rate-limiter.service.ts";

/**
 * A frozen twin of `rateLimit.ts`'s in-memory fixed-window fallback:
 * per-process rather than per-fleet, so a larger-than-intended burst gets
 * through but stays bounded — the app's own degraded mode when Redis is down.
 */

/** Above this many live keys the map is swept, so a stream of distinct keys cannot leak. */
const MEMORY_GC_THRESHOLD = 1000;

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

export class InMemoryWebhookDispatchRateLimiterService extends WebhookDispatchRateLimiter {
  private readonly entries = new Map<string, MemoryEntry>();

  static create(): InMemoryWebhookDispatchRateLimiterService {
    return new InMemoryWebhookDispatchRateLimiterService();
  }

  async limit({
    key,
    windowSeconds,
    max,
  }: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<WebhookDispatchRateLimitResult> {
    const now = nowInstant().epochMilliseconds;
    this.sweepExpired(now);

    const existing = this.entries.get(key);
    if (!existing || existing.expiresAt <= now) {
      const expiresAt = now + windowSeconds * 1000;
      this.entries.set(key, { count: 1, expiresAt });
      return { allowed: 1 <= max, remaining: max - 1, resetAt: expiresAt };
    }

    existing.count += 1;
    return {
      allowed: existing.count <= max,
      remaining: Math.max(0, max - existing.count),
      resetAt: existing.expiresAt,
    };
  }

  private sweepExpired(now: number): void {
    if (this.entries.size < MEMORY_GC_THRESHOLD) return;
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }
}
