import { TtlCache } from "../utils/ttlCache";

interface CacheEntry {
  value: boolean;
  timestamp: number;
  isRefreshing?: boolean;
}

/**
 * Cache with stale-while-revalidate pattern for feature flags.
 *
 * Uses TtlCache (Redis-backed) for cross-instance sharing.
 *
 * ## TTL Configuration
 *
 * The cache uses a 5-second TTL (see `FEATURE_FLAG_CACHE_TTL_MS`) which provides:
 * - Fast kill switch response (changes propagate within 5 seconds)
 * - Reduced PostHog API calls (one call per 5 seconds per unique key)
 * - Resilience to PostHog outages (serves cached values while down)
 *
 * @see dev/docs/adr/005-feature-flags.md for architecture decisions
 * @see FEATURE_FLAG_CACHE_TTL_MS for TTL configuration
 */
export class StaleWhileRevalidateCache {
  private readonly staleThresholdMs: number;
  private readonly refreshThresholdMs: number;
  private readonly cache: TtlCache<CacheEntry>;

  constructor(staleThresholdMs: number, refreshThresholdMs: number) {
    this.staleThresholdMs = staleThresholdMs;
    this.refreshThresholdMs = refreshThresholdMs;
    this.cache = new TtlCache<CacheEntry>(staleThresholdMs, "feature_flag:");
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const entry = await this.cache.get(key);
    if (entry && this.isStale(entry)) {
      await this.cache.delete(key);
      return undefined;
    }
    return entry;
  }

  async set(key: string, value: boolean): Promise<void> {
    await this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  async delete(key: string): Promise<void> {
    await this.cache.delete(key);
  }

  isStale(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.staleThresholdMs;
  }

  shouldRefresh(entry: CacheEntry): boolean {
    return (
      Date.now() - entry.timestamp > this.refreshThresholdMs &&
      !entry.isRefreshing
    );
  }

  async markRefreshing(key: string, entry: CacheEntry): Promise<void> {
    entry.isRefreshing = true;
    await this.set(key, entry.value);
  }
}
