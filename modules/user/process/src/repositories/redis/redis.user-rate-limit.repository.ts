import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";

import {
  type UserRateLimitBudget,
  type UserRateLimitDecision,
  UserRateLimitRepository,
} from "../user-rate-limit.repository.ts";

const REDIS_RATE_LIMIT_PREFIX = "user:rate-limit:";

/**
 * Per-key fixed windows under user's own `user:rate-limit:` keys, since the store's limiter
 * would move them under its own prefix (ARCHITECTURE.md §3.3, as model-provider keeps its own).
 */
export class RedisUserRateLimitRepository extends UserRateLimitRepository {
  static create({ redis }: { redis: RedisConnection }): RedisUserRateLimitRepository {
    return new RedisUserRateLimitRepository(redis);
  }

  readonly #redis: RedisConnection;

  private constructor(redis: RedisConnection) {
    super();
    this.#redis = redis;
  }

  async check(input: UserRateLimitBudget): Promise<UserRateLimitDecision> {
    const redisKey = `${REDIS_RATE_LIMIT_PREFIX}${input.key}`;
    const count = await this.#redis.incr(redisKey);
    if (count === 1) {
      await this.#redis.expire(redisKey, input.windowSeconds);
    }
    const ttl = await this.#redis.ttl(redisKey);

    return {
      allowed: count <= input.max,
      resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
    };
  }
}
