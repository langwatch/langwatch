import type { RateLimiter } from "@langwatch/process-stores";

import type {
  AuthRateLimitDecision,
  AuthRateLimitRepository,
} from "../auth-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisAuthRateLimitRepository implements AuthRateLimitRepository {
  static create({ limiter }: { limiter: RateLimiter }): RedisAuthRateLimitRepository {
    return new RedisAuthRateLimitRepository(limiter);
  }

  readonly #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<AuthRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
