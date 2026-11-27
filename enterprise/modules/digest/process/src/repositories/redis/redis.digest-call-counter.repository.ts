// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
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
  ): Promise<Readonly<{ allowed: boolean }>> {
    const redisKey = `${KEY_PREFIX}${input.key}`;
    const count = await this.#redis.incr(redisKey);
    const ttl = await this.#redis.ttl(redisKey);
    // Only the first call opens the window, so later calls cannot push its end out. A TTL of -1
    // is a key orphaned by a crash between incr and expire: without re-arming it the caller
    // would stay rate-limited forever, and unsubscribe must always work.
    if (count === 1 || ttl === -1) await this.#redis.expire(redisKey, input.windowSeconds);
    return { allowed: count <= input.max };
  }
}
