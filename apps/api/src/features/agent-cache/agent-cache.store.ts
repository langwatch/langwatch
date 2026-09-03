/**
 * The two expiring stores an agent-cache entry can live in.
 *
 * Redis when this process opened one, an in-process map otherwise — and the
 * fallback is the CONTRACT rather than a degradation: entries are work a run
 * already paid for, so a single-pod deployment with no Redis reuses them
 * within the pod exactly as the platform application did. What is different
 * here is that neither store registers itself: the process hands one in, so
 * two processes (or two tests) cannot share an entry keyspace by accident.
 */
import type { RedisConnection } from "@langwatch/redis-client";

import { AgentCacheEntryStorePort } from "./agent-cache.repository";

/** The entry keyspace, shared across every pod of one deployment. */
export class RedisAgentCacheEntryStore extends AgentCacheEntryStorePort {
  static create(redis: RedisConnection): RedisAgentCacheEntryStore {
    return new RedisAgentCacheEntryStore(redis);
  }

  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  async get(key: string): Promise<string | undefined> {
    return (await this.redis.get(key)) ?? undefined;
  }

  async set(key: string, value: string, ttlMs: number): Promise<void> {
    await this.redis.set(key, value, "PX", ttlMs);
  }

  /**
   * `SET … PX … NX`, one round trip.
   *
   * A read followed by a write would leave a window in which two runs both
   * read nothing and both believe they took the name, which is the exact
   * duplication the claim exists to prevent.
   */
  async claim(key: string, value: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(key, value, "PX", ttlMs, "NX")) === "OK";
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }
}

/** The per-process keyspace a deployment with no Redis uses. */
export class MemoryAgentCacheEntryStore extends AgentCacheEntryStorePort {
  private readonly entries = new Map<string, { value: string; expiresAt: number }>();

  static create(): MemoryAgentCacheEntryStore {
    return new MemoryAgentCacheEntryStore();
  }

  get(key: string): Promise<string | undefined> {
    return Promise.resolve(this.live(key)?.value);
  }

  set(key: string, value: string, ttlMs: number): Promise<void> {
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return Promise.resolve();
  }

  claim(key: string, value: string, ttlMs: number): Promise<boolean> {
    if (this.live(key)) return Promise.resolve(false);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    return Promise.resolve(true);
  }

  delete(key: string): Promise<void> {
    this.entries.delete(key);
    return Promise.resolve();
  }

  /** Reads the entry and drops it in the same step when its lifetime is spent. */
  private live(key: string): { value: string; expiresAt: number } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }
}
