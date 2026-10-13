import {
  type CachedStorageBytes,
  type CachedStorageBytesLookup,
  STORAGE_METER_CACHE_TTL_MS,
  StorageMeterCacheRepository,
} from "../storage-meter-cache.repository.ts";

const REFRESH_CLAIM_MS = 60_000;

/** The memory tier's storage-meter cache: entries and refresh claims expire as Redis's would. */
export class MemoryStorageMeterCacheRepository extends StorageMeterCacheRepository {
  static create(
    options: { ttlMs: number; now?: () => number } = { ttlMs: STORAGE_METER_CACHE_TTL_MS },
  ): MemoryStorageMeterCacheRepository {
    return new MemoryStorageMeterCacheRepository(options.ttlMs, options.now ?? Date.now);
  }

  readonly #entries = new Map<string, { value: CachedStorageBytes; expiresAt: number }>();
  readonly #claims = new Map<string, number>();

  private constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {
    super();
  }

  async get(key: string): Promise<CachedStorageBytesLookup> {
    const entry = this.#entries.get(key);
    if (!entry || entry.expiresAt < this.now()) {
      this.#entries.delete(key);
      return { kind: "miss" };
    }

    return { kind: "hit", value: entry.value };
  }

  async set(key: string, value: CachedStorageBytes): Promise<void> {
    this.#entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }

  async claim(key: string, _value: number): Promise<boolean> {
    const expiresAt = this.#claims.get(key);
    if (expiresAt !== undefined && expiresAt > this.now()) return false;

    this.#claims.set(key, this.now() + REFRESH_CLAIM_MS);
    return true;
  }
}
