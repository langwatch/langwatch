import { nowInstant } from "@langwatch/time";

import type { GatewayAgentCacheEntryRepository } from "../gateway-agent-cache.repository.ts";

/** The agent cache in memory: entries lapse at their lifetime, as Redis expires them. */
export class MemoryGatewayAgentCacheEntryRepository implements GatewayAgentCacheEntryRepository {
  readonly #entries = new Map<string, { value: string; expiresAt: number }>();

  static create(): MemoryGatewayAgentCacheEntryRepository {
    return new MemoryGatewayAgentCacheEntryRepository();
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
