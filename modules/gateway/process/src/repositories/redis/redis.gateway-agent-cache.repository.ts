import type { RedisConnection } from "@langwatch/redis-client";

import {
  GatewayAgentCacheEntryUnreadableError,
  type GatewayAgentCacheEntryRepository,
} from "../gateway-agent-cache.repository.ts";
import type { GatewayCipher } from "../gateway.repositories.ts";

/** The agent cache in Redis: each value rests sealed with the process's cipher. */
export class RedisGatewayAgentCacheEntryRepository implements GatewayAgentCacheEntryRepository {
  readonly #redis: RedisConnection;
  readonly #cipher: GatewayCipher;

  static create({
    redis,
    cipher,
  }: Readonly<{
    redis: RedisConnection;
    cipher: GatewayCipher;
  }>): RedisGatewayAgentCacheEntryRepository {
    return new RedisGatewayAgentCacheEntryRepository(redis, cipher);
  }

  private constructor(redis: RedisConnection, cipher: GatewayCipher) {
    this.#redis = redis;
    this.#cipher = cipher;
  }

  async find(key: string): Promise<string | undefined> {
    const sealed = await this.#redis.get(key);
    if (sealed === null) return undefined;

    try {
      return this.#cipher.decrypt(sealed);
    } catch (error) {
      throw new GatewayAgentCacheEntryUnreadableError({ cause: error });
    }
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.#redis.set(key, this.#cipher.encrypt(value), "PX", ttlMs);
  }

  async claim(key: string, value: string, ttlMs: number): Promise<boolean> {
    return (await this.#redis.set(key, this.#cipher.encrypt(value), "PX", ttlMs, "NX")) === "OK";
  }

  async delete(key: string): Promise<void> {
    await this.#redis.del(key);
  }
}
