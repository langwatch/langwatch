import type { RedisConnection } from "@langwatch/redis-client";

import type { GatewayAgentCacheEntryRepository } from "../../repositories/gateway-agent-cache.repository.ts";
import { nowInstant } from "@langwatch/time";

export type GatewayAgentCacheEntryStore = GatewayAgentCacheEntryRepository;

export class RedisGatewayAgentCacheEntryStore implements GatewayAgentCacheEntryStore {
  readonly #redis: RedisConnection;

  static create(redis: RedisConnection): RedisGatewayAgentCacheEntryStore {
    return new RedisGatewayAgentCacheEntryStore(redis);
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

export class MemoryGatewayAgentCacheEntryStore implements GatewayAgentCacheEntryStore {
  readonly #entries = new Map<string, { value: string; expiresAt: number }>();

  static create(): MemoryGatewayAgentCacheEntryStore {
    return new MemoryGatewayAgentCacheEntryStore();
  }

  find(key: string): Promise<string | undefined> {
    return Promise.resolve(this.#live(key)?.value);
  }

  set(key: string, value: string, ttlMs: number): Promise<void> {
    this.#entries.set(key, { value, expiresAt: nowInstant().epochMilliseconds + ttlMs });
    return Promise.resolve();
  }

  claim(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.#live(key)) return Promise.resolve(false);

    this.#entries.set(key, { value, expiresAt: nowInstant().epochMilliseconds + ttlMs });
    return Promise.resolve(true);
  }

  delete(key: string): Promise<void> {
    this.#entries.delete(key);
    return Promise.resolve();
  }

  #live(key: string): { value: string; expiresAt: number } | undefined {
    const entry = this.#entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= nowInstant().epochMilliseconds) {
      this.#entries.delete(key);
      return undefined;
    }

    return entry;
  }
}
