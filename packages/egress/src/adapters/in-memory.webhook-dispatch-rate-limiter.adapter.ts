import {
  WebhookDispatchRateLimiterPort,
  type WebhookDispatchRateLimitResult,
} from "../ports/webhook-dispatch-rate-limiter.port";

/**
 * The dispatch counter a process keeps when it shares none.
 *
 * FROZEN TWIN of the in-memory branch of `platform/app/src/server/rateLimit.ts`,
 * including its fixed-window approximation and its opportunistic sweep. This is
 * the degraded mode, not the intended one: a ceiling enforced per process rather
 * than per fleet lets a burst through that is larger than intended, but still
 * bounded — which is the application's own behaviour when its Redis is down, and
 * is why the fallback exists at all rather than the cap failing open.
 */

/** Above this many live keys the map is swept, so a stream of distinct keys cannot leak. */
const MEMORY_GC_THRESHOLD = 1000;

interface MemoryEntry {
  count: number;
  expiresAt: number;
}

export class InMemoryWebhookDispatchRateLimiterAdapter extends WebhookDispatchRateLimiterPort {
  private readonly entries = new Map<string, MemoryEntry>();

  static create(): InMemoryWebhookDispatchRateLimiterAdapter {
    return new InMemoryWebhookDispatchRateLimiterAdapter();
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
    const now = Date.now();
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
