import type { BetterAuthOptions } from "better-auth";

type SecondaryStorage = NonNullable<BetterAuthOptions["secondaryStorage"]>;

type Entry = { value: string; expiresAt: number };

/** Whole seconds, at least one, as the Redis twin rounds them. */
function expiryMs(ttl: number): number {
  return Math.max(1, Math.ceil(ttl)) * 1000;
}

/**
 * The memory tier's secondary storage: the Redis twin's semantics over a Map,
 * so sessions and rate-limit counters are kept and expire as they do live.
 */
export class MemoryBetterAuthMapSecondaryStorageRepository {
  readonly #entries = new Map<string, Entry>();
  readonly #now: () => number;

  private constructor(now: () => number) {
    this.#now = now;
  }

  static create(options: { now?: () => number } = {}): SecondaryStorage {
    const storage = new MemoryBetterAuthMapSecondaryStorageRepository(options.now ?? Date.now);

    return {
      get: async (key) => storage.#live(key)?.value ?? null,
      getAndDelete: async (key) => {
        const entry = storage.#live(key);
        storage.#entries.delete(key);
        return entry?.value ?? null;
      },
      // The TTL is set only when the counter is created, so traffic never extends the window.
      increment: async (key, ttl) => {
        const entry = storage.#live(key);
        const count = entry ? Number(entry.value) + 1 : 1;
        const expiresAt = entry?.expiresAt ?? storage.#now() + expiryMs(ttl);
        storage.#entries.set(key, { value: String(count), expiresAt });
        return count;
      },
      // A value with no time left is deleted, never kept bare, as the Redis twin does.
      set: async (key, value, ttl) => {
        if (ttl && ttl > 0) {
          storage.#entries.set(key, { value, expiresAt: storage.#now() + expiryMs(ttl) });
        } else {
          storage.#entries.delete(key);
        }
      },
      delete: async (key) => {
        storage.#entries.delete(key);
      },
    };
  }

  #live(key: string): Entry | undefined {
    const entry = this.#entries.get(key);
    if (entry && entry.expiresAt <= this.#now()) {
      this.#entries.delete(key);
      return undefined;
    }
    return entry;
  }
}
