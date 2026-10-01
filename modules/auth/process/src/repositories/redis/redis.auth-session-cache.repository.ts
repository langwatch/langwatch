import type { RedisConnection } from "@langwatch/redis-client";

import type { AuthSessionCacheRepository } from "../auth-session-cache.repository.ts";

/**
 * The session cache over the deployment's own connection. Keys are written
 * exactly as Better Auth writes them, prefix included: this repository exists
 * to evict what that library wrote, and a namespace of our own would revoke nothing.
 */
type AuthSessionCacheRedis = Pick<RedisConnection, "get" | "set" | "del">;

export class RedisAuthSessionCacheRepository implements AuthSessionCacheRepository {
  private constructor(private readonly redis: AuthSessionCacheRedis) {}

  static create({ redis }: { redis: AuthSessionCacheRedis }): AuthSessionCacheRepository {
    return new RedisAuthSessionCacheRepository(redis);
  }

  async findValues({ key }: { key: string }): Promise<string[]> {
    const value = await this.redis.get(key);
    return value === null ? [] : [value];
  }

  async set({ key, value }: { key: string; value: string }): Promise<void> {
    await this.redis.set(key, value);
  }

  async delete({ key }: { key: string }): Promise<void> {
    await this.redis.del(key);
  }
}
