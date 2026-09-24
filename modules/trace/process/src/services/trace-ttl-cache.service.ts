import { nowInstant } from "@langwatch/time";

type MemoryEntry<T> = { value: T; expiresAt: number };

export type TraceTtlCacheLookup<T> = { kind: "hit"; value: T } | { kind: "miss" };

/**
 * The per-pod TTL cache behind the explorer's facet and discover reads. Each pod keeps its own
 * entries; a cold pod recomputes once and serves from memory until the entry lapses.
 */
export class TraceTtlCacheService<T> {
  static create<T>(ttlMs: number): TraceTtlCacheService<T> {
    return new TraceTtlCacheService<T>(ttlMs);
  }

  private readonly memory = new Map<string, MemoryEntry<T>>();

  private constructor(private readonly ttlMs: number) {}

  async get(key: string): Promise<TraceTtlCacheLookup<T>> {
    const entry = this.memory.get(key);
    if (!entry) {
      return { kind: "miss" };
    }

    if (nowInstant().epochMilliseconds > entry.expiresAt) {
      this.memory.delete(key);

      return { kind: "miss" };
    }

    return { kind: "hit", value: entry.value };
  }

  /** Write `key`; `ttlMs` overrides the cache's own lifetime for this entry only. */
  async set(key: string, value: T, ttlMs?: number): Promise<void> {
    this.memory.set(key, {
      value,
      expiresAt: nowInstant().epochMilliseconds + (ttlMs ?? this.ttlMs),
    });
  }

  /** Claims `key` only if unset, reporting whether this call took it. */
  async claim(key: string, value: T, ttlMs?: number): Promise<boolean> {
    if ((await this.get(key)).kind === "hit") {
      return false;
    }

    await this.set(key, value, ttlMs);

    return true;
  }

  async delete(key: string): Promise<void> {
    this.memory.delete(key);
  }
}
