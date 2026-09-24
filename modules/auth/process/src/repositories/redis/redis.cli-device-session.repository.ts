import { CliSessionRecordNotFoundError } from "@langwatch/auth-contract";

import type { CliDeviceSessionRepository } from "../cli-device-session.repository.ts";

type CliDeviceSessionRedis = Readonly<{
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttlSeconds: number): Promise<unknown>;
  set(
    key: string,
    value: string,
    mode: "EX",
    ttlSeconds: number,
    condition: "NX",
  ): Promise<"OK" | null>;
  del(key: string): Promise<number>;
  sadd(key: string, ...members: string[]): Promise<number>;
  pexpire(key: string, ttlMs: number): Promise<number>;
  srem(key: string, member: string): Promise<number>;
}>;

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
}
