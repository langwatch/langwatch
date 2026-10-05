import type { RedisConnection } from "@langwatch/redis-client";

import type { GatewayAgentCacheEntryRepository } from "../../repositories/gateway-agent-cache.repository.ts";

export type GatewayAgentCacheEntryStore = GatewayAgentCacheEntryRepository;

export class RedisGatewayAgentCacheEntryRepository implements GatewayAgentCacheEntryStore {
  readonly #redis: RedisConnection;

  static create(redis: RedisConnection): RedisGatewayAgentCacheEntryRepository {
    return new RedisGatewayAgentCacheEntryRepository(redis);
  }

  private constructor(redis: RedisConnection) {
    this.#redis = redis;
  }

  async find(key: string): Promise<string | undefined> {
    return (await this.#redis.get(key)) ?? undefined;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.#redis.set(key, value, "PX", ttlMs);
  }

  async claim(key: string, value: string, ttlMs: number): Promise<boolean> {
    return (await this.#redis.set(key, value, "PX", ttlMs, "NX")) === "OK";
  }

  async delete(key: string): Promise<void> {
    await this.#redis.del(key);
  }
}
