import type { RedisConnection } from "@langwatch/redis-client";

import type { CliDeviceSessionRepository } from "../cli-device-session.repository.ts";

/** The Auth-owned Redis backing store for RFC 8628 device sessions. */
export class RedisCliDeviceSessionRepository implements CliDeviceSessionRepository {
  private constructor(private readonly redis: RedisConnection) {}

  static create(redis: RedisConnection): RedisCliDeviceSessionRepository {
    return new RedisCliDeviceSessionRepository(redis);
  }

  tryGet(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(input: { key: string; value: string; ttlSeconds: number }): Promise<void> {
    await this.redis.set(input.key, input.value, "EX", input.ttlSeconds);
  }

  async setIfAbsent(input: { key: string; value: string; ttlSeconds: number }): Promise<boolean> {
    return (await this.redis.set(input.key, input.value, "EX", input.ttlSeconds, "NX")) === "OK";
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async indexTokens(input: { indexKey: string; memberKeys: string[]; ttlMs: number }): Promise<void> {
    if (input.memberKeys.length === 0) return;

    await this.redis.sadd(input.indexKey, ...input.memberKeys);
    await this.redis.pexpire(input.indexKey, input.ttlMs);
  }

  async removeFromIndex(input: { indexKey: string; memberKey: string }): Promise<void> {
    await this.redis.srem(input.indexKey, input.memberKey);
  }
}
