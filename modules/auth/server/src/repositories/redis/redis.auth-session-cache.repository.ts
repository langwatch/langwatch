import type { RedisConnection } from "@langwatch/redis-client";
import type { AuthSessionCacheRepository } from "../auth-session-cache.repository.ts";

/**
 * The session cache over the deployment's own connection.
 *
 * Keys are written exactly as Better Auth writes them, prefix included, because
 * this repository exists to evict what that library wrote: a namespace of our
 * own would leave its entries live and revoke nothing.
 */
export class RedisAuthSessionCacheRepository implements AuthSessionCacheRepository {
  private constructor(private readonly redis: RedisConnection) {}

  /** `null` where the deployment composed no connection: the cache is optional. */
  static create({
    redis,
  }: {
    redis: RedisConnection | null;
  }): AuthSessionCacheRepository | null {
    return redis ? new RedisAuthSessionCacheRepository(redis) : null;
  }

  async findValue({ key }: { key: string }): Promise<string | null> {
    return this.redis.get(key);
  }

  async set({ key, value }: { key: string; value: string }): Promise<void> {
    await this.redis.set(key, value);
  }

  async delete({ key }: { key: string }): Promise<void> {
    await this.redis.del(key);
  }
}
