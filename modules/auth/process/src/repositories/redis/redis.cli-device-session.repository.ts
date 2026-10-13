import { CliSessionRecordNotFoundError } from "@langwatch/auth-contract";
import type { RedisConnection } from "@langwatch/redis-client";

import type { CliDeviceSessionRepository } from "../cli-device-session.repository.ts";

type CliDeviceSessionRedis = Pick<
  RedisConnection,
  "get" | "set" | "del" | "sadd" | "pexpire" | "srem" | "smembers"
>;

/** The Auth-owned Redis backing store for RFC 8628 device sessions. */
export class RedisCliDeviceSessionRepository implements CliDeviceSessionRepository {
  private constructor(private readonly redis: CliDeviceSessionRedis) {}

  static create(redis: CliDeviceSessionRedis): RedisCliDeviceSessionRepository {
    return new RedisCliDeviceSessionRepository(redis);
  }

  async get(key: string): Promise<string> {
    const value = await this.redis.get(key);
    if (value === null) throw new CliSessionRecordNotFoundError();

    return value;
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

  async indexTokens(input: {
    indexKey: string;
    memberKeys: string[];
    ttlMs: number;
  }): Promise<void> {
    if (input.memberKeys.length === 0) return;

    await this.redis.sadd(input.indexKey, ...input.memberKeys);
    await this.redis.pexpire(input.indexKey, input.ttlMs);
  }

  async removeFromIndex(input: { indexKey: string; memberKey: string }): Promise<void> {
    await this.redis.srem(input.indexKey, input.memberKey);
  }

  findIndexedTokens(indexKey: string): Promise<string[]> {
    return this.redis.smembers(indexKey);
  }

  async deleteIndexedTokens(input: {
    indexKey: string;
    memberKeys: readonly string[];
  }): Promise<number> {
    if (input.memberKeys.length === 0) return 0;

    let deleted = 0;
    for (const memberKey of input.memberKeys) {
      deleted += await this.redis.del(memberKey);
    }
    await this.redis.srem(input.indexKey, ...input.memberKeys);
    return deleted;
  }
}
