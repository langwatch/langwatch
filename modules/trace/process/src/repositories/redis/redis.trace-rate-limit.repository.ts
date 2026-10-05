import type { RateLimiter } from "@langwatch/process-stores";

import {
  type TraceRateLimitDecision,
  TraceRateLimitRepository,
} from "../trace-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisTraceRateLimitRepository extends TraceRateLimitRepository {
  static create(limiter: RateLimiter): RedisTraceRateLimitRepository {
    return new RedisTraceRateLimitRepository(limiter);
  }

  #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    super();
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<TraceRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
