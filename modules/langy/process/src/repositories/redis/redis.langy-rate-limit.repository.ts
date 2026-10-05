import type { RateLimiter } from "@langwatch/process-stores";

import {
  type LangyRateLimitDecision,
  LangyRateLimitRepository,
} from "../langy-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisLangyRateLimitRepository extends LangyRateLimitRepository {
  static create(limiter: RateLimiter): RedisLangyRateLimitRepository {
    return new RedisLangyRateLimitRepository(limiter);
  }

  readonly #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    super();
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<LangyRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
