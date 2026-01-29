import { isBuildOrNoRedis, connection as redisConnection } from "../redis";
import { TtlCache } from "../utils/ttlCache";

interface CacheEntry {
  value: boolean;
  timestamp: number;
  isRefreshing?: boolean;
}

/**
 * Hybrid Redis/in-memory cache with stale-while-revalidate pattern.
 *
 * This cache provides fast, resilient caching for feature flags with automatic
 * fallback from Redis to in-memory storage when Redis is unavailable.
 *
 * ## Cache Strategy
 *
 * 1. **Redis first**: When available, uses Redis for cross-instance cache sharing
 * 2. **Memory fallback**: Falls back to in-memory TtlCache when Redis is down
 * 3. **Stale-while-revalidate**: Returns cached data immediately, refreshes in background
 *
 * ## Key Structure
 *
 * Redis keys are prefixed with `feature_flag:` followed by a composite key:
 * `{flagKey}:{distinctId}:{projectId}:{organizationId}`
 *
 * ## TTL Configuration
 *
 * The cache uses a 5-second TTL (see `FEATURE_FLAG_CACHE_TTL_MS`) which provides:
 * - Fast kill switch response (changes propagate within 5 seconds)
 * - Reduced PostHog API calls (one call per 5 seconds per unique key)
 * - Resilience to PostHog outages (serves cached values while down)
 *
 * @see docs/adr/005-feature-flags.md for architecture decisions
 * @see FEATURE_FLAG_CACHE_TTL_MS for TTL configuration
 */
export class StaleWhileRevalidateCache {
  private readonly staleThresholdMs: number; // How long before considering data stale
  private readonly refreshThresholdMs: number; // How long before triggering background refresh
  private readonly prefix = "feature_flag:";

  // In-memory cache for fast access and Redis fallback
  private readonly memoryCache: TtlCache<CacheEntry>;

  constructor(staleThresholdMs: number, refreshThresholdMs: number) {
    this.staleThresholdMs = staleThresholdMs;
    this.refreshThresholdMs = refreshThresholdMs;

    // Memory cache TTL matches stale threshold
    this.memoryCache = new TtlCache<CacheEntry>(staleThresholdMs);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    // Try Redis first if available
    if (redisConnection && !isBuildOrNoRedis) {
      try {
        const result = await redisConnection.get(`${this.prefix}${key}`);
        if (result !== null) {
          const entry: CacheEntry = JSON.parse(result);
          // Redis TTL handles expiration, so if it exists it's valid
          return entry;
        }
      } catch (_error) {
        // Redis failed, fall through to memory cache
      }
    }

    // Fall back to memory cache
    const entry = this.memoryCache.get(key);
    // Check if memory cache entry is stale
    if (entry && this.isStale(entry)) {
      this.memoryCache.delete(key);
      return undefined;
    }
    return entry;
  }

  async set(key: string, value: boolean): Promise<void> {
    const entry: CacheEntry = {
      value,
      timestamp: Date.now(),
    };

    // Try Redis first if available
    if (redisConnection && !isBuildOrNoRedis) {
      try {
        // Store for stale threshold (convert ms to seconds)
        const ttlSeconds = Math.ceil(this.staleThresholdMs / 1000);
        await redisConnection.setex(
          `${this.prefix}${key}`,
          ttlSeconds,
          JSON.stringify(entry),
        );
      } catch (_error) {
        // Redis failed, fall through to memory cache
      }
    }

    // Always set in memory cache
    this.memoryCache.set(key, entry);
  }

  async delete(key: string): Promise<void> {
    // Try Redis first if available
    if (redisConnection && !isBuildOrNoRedis) {
      try {
        await redisConnection.del(`${this.prefix}${key}`);
      } catch (_error) {
        // Redis failed, continue to memory cache
      }
    }

    // Always delete from memory cache
    this.memoryCache.delete(key);
  }

  async clear(): Promise<void> {
    // Try Redis first if available
    if (redisConnection && !isBuildOrNoRedis) {
      try {
        const keys = await redisConnection.keys(`${this.prefix}*`);
        if (keys.length > 0) {
          await redisConnection.del(...keys);
        }
      } catch (_error) {
        // Redis failed, continue to memory cache
      }
    }

    // Always clear memory cache
    this.memoryCache.clear();
  }

  /**
   * Check if entry is stale (needs background refresh).
   */
  isStale(entry: CacheEntry): boolean {
    return Date.now() - entry.timestamp > this.staleThresholdMs;
  }

  /**
   * Check if entry should trigger background refresh.
   */
  shouldRefresh(entry: CacheEntry): boolean {
    return (
      Date.now() - entry.timestamp > this.refreshThresholdMs &&
      !entry.isRefreshing
    );
  }

  /**
   * Mark entry as being refreshed.
   */
  async markRefreshing(key: string, entry: CacheEntry): Promise<void> {
    entry.isRefreshing = true;
    await this.set(key, entry.value); // This will update the timestamp too
  }

  /**
   * Check if Redis is available.
   */
  isRedisAvailable(): boolean {
    return !isBuildOrNoRedis && !!redisConnection;
  }
}
