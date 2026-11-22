import type { RateLimiter } from "@langwatch/process-stores";

import type {
  WebhookRateLimitDecision,
  WebhookRateLimitRepository,
} from "../webhook-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisWebhookRateLimitRepository implements WebhookRateLimitRepository {
  static create(limiter: RateLimiter): RedisWebhookRateLimitRepository {
    return new RedisWebhookRateLimitRepository(limiter);
  }

  readonly #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<WebhookRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
