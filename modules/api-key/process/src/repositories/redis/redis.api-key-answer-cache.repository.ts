import type { Cluster, Redis } from "ioredis";

import {
  API_KEY_ANSWER_TTL_MS,
  ApiKeyAnswerCacheRepository,
} from "../api-key-answer-cache.repository.ts";

const KEY_PREFIX = "api-key-answer:";

/** Only what the cache calls. */
export type ApiKeyAnswerCacheRedis = Pick<Redis | Cluster, "get" | "set" | "del">;

/** The shared answers over the deployment's own connection; every write carries its expiry. */
export class RedisApiKeyAnswerCacheRepository extends ApiKeyAnswerCacheRepository {
  private constructor(private readonly redis: ApiKeyAnswerCacheRedis) {
    super();
  }

  static create({ redis }: { redis: ApiKeyAnswerCacheRedis }): RedisApiKeyAnswerCacheRepository {
    return new RedisApiKeyAnswerCacheRepository(redis);
  }

  async findValues({ key }: { key: string }): Promise<string[]> {
    const value = await this.redis.get(`${KEY_PREFIX}${key}`);
    return value === null ? [] : [value];
  }

  async set({
    key,
    value,
    ttlMs,
    onlyIfAbsent = false,
  }: {
    key: string;
    value: string;
    ttlMs: number;
    onlyIfAbsent?: boolean;
  }): Promise<void> {
    const expiresInMs = Math.max(1, Math.min(Math.floor(ttlMs), API_KEY_ANSWER_TTL_MS));
    if (onlyIfAbsent) {
      await this.redis.set(`${KEY_PREFIX}${key}`, value, "PX", expiresInMs, "NX");
      return;
    }
    await this.redis.set(`${KEY_PREFIX}${key}`, value, "PX", expiresInMs);
  }

  async delete({ key }: { key: string }): Promise<void> {
    await this.redis.del(`${KEY_PREFIX}${key}`);
  }
}
