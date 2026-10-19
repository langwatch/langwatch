import type { RateLimiter } from "@langwatch/process-stores";

import {
  type ScenarioRateLimitDecision,
  ScenarioRateLimitRepository,
} from "../scenario-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisScenarioRateLimitRepository extends ScenarioRateLimitRepository {
  static create(limiter: RateLimiter): RedisScenarioRateLimitRepository {
    return new RedisScenarioRateLimitRepository(limiter);
  }

  #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    super();
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<ScenarioRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
