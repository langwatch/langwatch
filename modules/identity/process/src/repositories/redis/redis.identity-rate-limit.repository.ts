import type { RateLimiter } from "@langwatch/process-stores";

import {
  type IdentityRateLimitDecision,
  IdentityRateLimitRepository,
} from "../identity-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisIdentityRateLimitRepository extends IdentityRateLimitRepository {
  static create(limiter: RateLimiter): RedisIdentityRateLimitRepository {
    return new RedisIdentityRateLimitRepository(limiter);
  }

  #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    super();
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit?: Readonly<{ requests: number; seconds: number }>,
  ): Promise<IdentityRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
