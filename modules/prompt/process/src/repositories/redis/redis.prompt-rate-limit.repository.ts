import type { RateLimiter } from "@langwatch/process-stores";

import {
  type PromptRateLimitDecision,
  PromptRateLimitRepository,
} from "../prompt-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisPromptRateLimitRepository extends PromptRateLimitRepository {
  static create(limiter: RateLimiter): RedisPromptRateLimitRepository {
    return new RedisPromptRateLimitRepository(limiter);
  }

  readonly #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    super();
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<PromptRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
