import type { RateLimiter } from "@langwatch/process-stores";

import {
  type StoredObjectRateLimitDecision,
  StoredObjectRateLimitRepository,
} from "../stored-object-rate-limit.repository.ts";

/** The process's Redis-backed limiter, so a window is shared by every replica. */
export class RedisStoredObjectRateLimitRepository extends StoredObjectRateLimitRepository {
  static create(limiter: RateLimiter): RedisStoredObjectRateLimitRepository {
    return new RedisStoredObjectRateLimitRepository(limiter);
  }

  readonly #limiter: RateLimiter;

  private constructor(limiter: RateLimiter) {
    super();
    this.#limiter = limiter;
  }

  check(
    key: string,
    limit: Readonly<{ requests: number; seconds: number }>,
  ): Promise<StoredObjectRateLimitDecision> {
    return this.#limiter.check(key, limit);
  }
}
