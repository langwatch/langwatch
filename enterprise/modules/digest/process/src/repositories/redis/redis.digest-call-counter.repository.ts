// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { nowInstant } from "@langwatch/time";

import type { DigestCallCounterRepository } from "../digest-call-counter.repository.ts";

/** Only the commands this repository calls. */
export type DigestCallCounterRedis = Readonly<{
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
}>;

const KEY_PREFIX = "digest:call-counter:";

/** The fixed-window call count, fleet-wide in Redis. */
export class RedisDigestCallCounterRepository implements DigestCallCounterRepository {
  readonly #redis: DigestCallCounterRedis;

  static create({
    redis,
  }: Readonly<{ redis: DigestCallCounterRedis }>): RedisDigestCallCounterRepository {
    return new RedisDigestCallCounterRepository(redis);
  }

  private constructor(redis: DigestCallCounterRedis) {
    this.#redis = redis;
  }

  async count(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; resetAt: number }>> {
    const redisKey = `${KEY_PREFIX}${input.key}`;
    const count = await this.#redis.incr(redisKey);
    // Only the first call opens the window, so later calls cannot push its end out.
    if (count === 1) await this.#redis.expire(redisKey, input.windowSeconds);
    const ttl = await this.#redis.ttl(redisKey);
    return {
      allowed: count <= input.max,
      resetAt: nowInstant().epochMilliseconds + (ttl > 0 ? ttl : input.windowSeconds) * 1000,
    };
  }
}
