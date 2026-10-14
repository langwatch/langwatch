import type { RedisConnection } from "@langwatch/redis-client";
import { nowInstant } from "@langwatch/time";

import { AutomationCallCounterRepository } from "../automation-call-counter.repository.ts";

const REDIS_CALL_COUNTER_PREFIX = "automation:call-counter:";

/** The fixed-window call count, fleet-wide in Redis. */
export class RedisAutomationCallCounterRepository extends AutomationCallCounterRepository {
  static create(input: {
    connection: Pick<RedisConnection, "incr" | "expire" | "ttl">;
  }): RedisAutomationCallCounterRepository {
    return new RedisAutomationCallCounterRepository(input.connection);
  }

  private constructor(private readonly redis: Pick<RedisConnection, "incr" | "expire" | "ttl">) {
    super();
  }

  async count(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>> {
    const redisKey = `${REDIS_CALL_COUNTER_PREFIX}${input.key}`;
    const count = await this.redis.incr(redisKey);
    if (count === 1) {
      await this.redis.expire(redisKey, input.windowSeconds);
    }
    const ttl = await this.redis.ttl(redisKey);
    return {
      allowed: count <= input.max,
      resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
    };
  }
}
