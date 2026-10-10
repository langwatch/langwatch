// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { RateLimiter } from "@langwatch/process-stores";

import type {
  SaasRateLimitDecision,
  SaasRateLimitRepository,
} from "../saas-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisSaasRateLimitRepository implements SaasRateLimitRepository {
  static create({ limiter }: { limiter: RateLimiter }): RedisSaasRateLimitRepository {
    return new RedisSaasRateLimitRepository(limiter);
  }

  readonly #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<SaasRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
