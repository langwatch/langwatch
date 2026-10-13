// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { RateLimiter } from "@langwatch/process-stores";

import {
  type GovernanceRateLimitDecision,
  GovernanceRateLimitRepository,
} from "../governance-rate-limit.repository.ts";

/** The process's Redis-backed limiter, keyed as before, so a window is shared by every replica. */
export class RedisGovernanceRateLimitRepository extends GovernanceRateLimitRepository {
  static create(limiter: RateLimiter): RedisGovernanceRateLimitRepository {
    return new RedisGovernanceRateLimitRepository(limiter);
  }

  #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    super();
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<GovernanceRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
