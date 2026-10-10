import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";

import { ModelProviderRateLimitRepository } from "../model-provider-rate-limit.repository.ts";

/**
 * Connection-test counters over the process's Redis, so a window is shared by every replica.
 * Window and ceiling arrive per call (organization and global), under main's own key prefix.
 */
export class RedisModelProviderRateLimitRepository extends ModelProviderRateLimitRepository {
  static create(redis: RedisConnection): RedisModelProviderRateLimitRepository {
    return new RedisModelProviderRateLimitRepository(redis);
  }

  readonly #redis: RedisConnection;

  private constructor(redis: RedisConnection) {
    super();
    this.#redis = redis;
  }

  async consume(input: {
    key: string;
    windowSeconds: number;
    max: number;
  }): Promise<{ allowed: boolean; resetAt: number }> {
    const counter = `model-provider:rate-limit:${input.key}`;
    const now = nowInstant().epochMilliseconds;
    const used = await this.#redis.incr(counter);
    if (used === 1) await this.#redis.expire(counter, input.windowSeconds);
    if (used <= input.max) {
      return { allowed: true, resetAt: now + input.windowSeconds * 1000 };
    }

    const remaining = await this.#redis.ttl(counter);
    return { allowed: false, resetAt: now + Math.max(remaining, 0) * 1000 };
  }
}
