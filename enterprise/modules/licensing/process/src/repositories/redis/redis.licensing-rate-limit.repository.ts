import type { RateLimiter } from "@langwatch/process-stores";

import {
  type LicensingRateLimitDecision,
  LicensingRateLimitRepository,
} from "../licensing-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisLicensingRateLimitRepository extends LicensingRateLimitRepository {
  static create(limiter: RateLimiter): RedisLicensingRateLimitRepository {
    return new RedisLicensingRateLimitRepository(limiter);
  }

  #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    super();
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<LicensingRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
