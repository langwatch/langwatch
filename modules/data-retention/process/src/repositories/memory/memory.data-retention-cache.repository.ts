import type { ResolvedRetention } from "@langwatch/data-retention-contract";

import {
  type CachedRetentionLookup,
  DataRetentionCacheRepository,
  DATA_RETENTION_CACHE_TTL_MS,
} from "../data-retention-cache.repository.ts";

/** The memory tier's retention cache: one process's entries, expiring as Redis's would. */
export class MemoryDataRetentionCacheRepository extends DataRetentionCacheRepository {
  static create(
    options: { ttlMs: number; now?: () => number } = { ttlMs: DATA_RETENTION_CACHE_TTL_MS },
  ): MemoryDataRetentionCacheRepository {
    return new MemoryDataRetentionCacheRepository(options.ttlMs, options.now ?? Date.now);
  }

  readonly #entries = new Map<string, { value: ResolvedRetention; expiresAt: number }>();

  private constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {
    super();
  }

  async get(key: string): Promise<CachedRetentionLookup> {
    const entry = this.#entries.get(key);
    if (!entry || this.now() > entry.expiresAt) {
      this.#entries.delete(key);
      return { kind: "miss" };
    }

    return { kind: "hit", value: entry.value };
  }

  async set(key: string, value: ResolvedRetention): Promise<void> {
    this.#entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  async delete(key: string): Promise<void> {
    this.#entries.delete(key);
  }
}
