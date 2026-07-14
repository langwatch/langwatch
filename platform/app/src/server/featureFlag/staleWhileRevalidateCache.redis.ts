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
  private readonly maxTtlMs: number;
  private readonly cache: TtlCache<CacheEntry>;

  /**
   * @param staleThresholdMs default staleness threshold (returned to callers
   *   that don't pass an override). Frontend flags use this.
   * @param refreshThresholdMs background refresh threshold.
   * @param maxTtlMs underlying storage TTL — must be >= the longest
   *   per-call ttlOverrideMs any caller might pass, so Redis doesn't evict
   *   the entry before the override window expires. Defaults to staleThresholdMs.
   */
  constructor(
    staleThresholdMs: number,
    refreshThresholdMs: number,
    maxTtlMs: number = staleThresholdMs,
  ) {
    this.staleThresholdMs = staleThresholdMs;
    this.refreshThresholdMs = refreshThresholdMs;
    this.maxTtlMs = Math.max(staleThresholdMs, maxTtlMs);
    this.cache = new TtlCache<CacheEntry>(this.maxTtlMs, "feature_flag:");
  }

  /**
   * @param key cache key
   * @param ttlOverrideMs optional caller-provided staleness threshold. Used by
   *   hot-path callers (kill switches) to extend the cache window without
   *   changing the global default that user-facing flags rely on.
   *
   * Eviction rule: physically delete only when the absolute storage TTL
   * (maxTtlMs) is exceeded. For shorter per-caller thresholds, return
   * `undefined` silently — that way a short-window caller hitting a still-
   * valid entry doesn't evict it from under a long-window caller. This
   * matters if the same cache key is read from both a 5 s consumer and a
   * 60 s consumer; without it, the short-window read would defeat the
   * override the long-window caller asked for.
   */
  async get(
    key: string,
    ttlOverrideMs?: number,
  ): Promise<CacheEntry | undefined> {
    const entry = await this.cache.get(key);
    if (!entry) return undefined;
    const age = Date.now() - entry.timestamp;
    if (age > this.maxTtlMs) {
      await this.cache.delete(key);
      return undefined;
    }
    const threshold = ttlOverrideMs ?? this.staleThresholdMs;
    if (age > threshold) {
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
