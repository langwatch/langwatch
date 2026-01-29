import { isBuildOrNoRedis, connection as redisConnection } from "../redis";
import { TtlCache } from "../utils/ttlCache";

interface CacheEntry {
  value: boolean;
  timestamp: number;
  isRefreshing?: boolean;
}

/**
 * Hybrid cache with stale-while-revalidate pattern.
 * Always returns cached data immediately, but refreshes in background when stale, rapido.
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

    // Keep entries in memory much longer than stale threshold for background refresh
    this.memoryCache = new TtlCache<CacheEntry>(staleThresholdMs * 10);
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    // Try Redis first if available
    if (redisConnection && !isBuildOrNoRedis) {
      try {
        const result = await redisConnection.get(`${this.prefix}${key}`);
        if (result !== null) {
          const entry: CacheEntry = JSON.parse(result);
          return entry;
        }
      } catch (_error) {
        // Redis failed, fall through to memory cache
      }
    }

    // Fall back to memory cache
    return this.memoryCache.get(key);
  }

  async set(key: string, value: boolean): Promise<void> {
    const entry: CacheEntry = {
      value,
      timestamp: Date.now(),
    };

    // Try Redis first if available
    if (redisConnection && !isBuildOrNoRedis) {
      try {
        // Store for much longer than stale threshold (24 hours for Redis)
        await redisConnection.setex(
          `${this.prefix}${key}`,
          24 * 60 * 60, // 24 hours
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
