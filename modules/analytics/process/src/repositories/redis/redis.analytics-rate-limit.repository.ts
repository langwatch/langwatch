import type { RateLimiter } from "@langwatch/process-stores";

import {
  type AnalyticsRateLimitDecision,
  AnalyticsRateLimitRepository,
} from "../analytics-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisAnalyticsRateLimitRepository extends AnalyticsRateLimitRepository {
  static create(limiter: RateLimiter): RedisAnalyticsRateLimitRepository {
    return new RedisAnalyticsRateLimitRepository(limiter);
  }

  #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    super();
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<AnalyticsRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
