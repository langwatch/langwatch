import type { UsageCacheRepository } from "../usage-cache.repository.ts";

/** Both usage caches are 30-second windows in production. */
const USAGE_CACHE_TTL_MS = 30_000;

/** The per-pod usage cache: entries expire after the window they were set with. */
export class MemoryUsageCacheRepository implements UsageCacheRepository {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  static create({
    ttlMs = USAGE_CACHE_TTL_MS,
    now = Date.now,
  }: { ttlMs?: number; now?: () => number } = {}): MemoryUsageCacheRepository {
    return new MemoryUsageCacheRepository(ttlMs, now);
  }

  private constructor(
    private readonly ttlMs: number,
    private readonly now: () => number,
  ) {}

  async findValue<T>(key: string): Promise<T | undefined> {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.entries.set(key, { value, expiresAt: this.now() + this.ttlMs });
  }
}
