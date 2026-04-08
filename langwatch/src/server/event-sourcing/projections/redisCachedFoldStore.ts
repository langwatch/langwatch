import { performance } from "node:perf_hooks";
import type { Redis } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import {
  incrementEsFoldCacheTotal,
  observeEsFoldCacheGetDuration,
  observeEsFoldCacheStoreDuration,
  incrementEsFoldCacheRedisError,
} from "~/server/metrics";
import type { FoldProjectionStore } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:redis-cached-fold-store");

export interface RedisCachedFoldStoreOptions {
  keyPrefix: string;
  ttlSeconds?: number;
}

/**
 * Wraps any FoldProjectionStore with a Redis write-through cache.
 *
 * - get(): Redis first, ClickHouse fallback on miss.
 * - store(): ClickHouse first (throws on failure), then Redis SET (cache).
 *
 * Ordering guarantees correctness without transactions:
 * - CH fails → throw → no Redis update → event retried by queue
 * - CH succeeds, Redis fails → next read falls back to CH
 */
export class RedisCachedFoldStore<State>
  implements FoldProjectionStore<State>
{
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;

  constructor(
    private readonly inner: FoldProjectionStore<State>,
    private readonly redis: Redis,
    options: RedisCachedFoldStoreOptions,
  ) {
    this.keyPrefix = options.keyPrefix;
    this.ttlSeconds = options.ttlSeconds ?? 30;
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    const key = this.redisKey(aggregateId, context);
    const getStartTime = performance.now();
    let cached: string | null;
    try {
      cached = await this.redis.get(key);
    } catch (_error) {
      incrementEsFoldCacheRedisError(this.keyPrefix, "get");
      incrementEsFoldCacheTotal(this.keyPrefix, "fallback_error");
      // Fall through to inner store
      const innerStartTime = performance.now();
      const result = await this.inner.get(aggregateId, context);
      const innerDurationMs = performance.now() - innerStartTime;
      observeEsFoldCacheGetDuration(this.keyPrefix, "clickhouse", innerDurationMs);
      return result;
    }

    if (cached !== null) {
      const getDurationMs = performance.now() - getStartTime;
      incrementEsFoldCacheTotal(this.keyPrefix, "hit");
      observeEsFoldCacheGetDuration(this.keyPrefix, "redis", getDurationMs);
      return JSON.parse(cached) as State;
    }

    incrementEsFoldCacheTotal(this.keyPrefix, "miss");
    const innerStartTime = performance.now();
    const result = await this.inner.get(aggregateId, context);
    const innerDurationMs = performance.now() - innerStartTime;
    observeEsFoldCacheGetDuration(this.keyPrefix, "clickhouse", innerDurationMs);
    return result;
  }

  async store(
    state: State,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const aggregateId = context.key ?? context.aggregateId;
    const storeStartTime = performance.now();

    // 1. ClickHouse first — throws on failure, event retried by queue
    await this.inner.store(state, context);

    // 2. Redis second — cache for fast reads on next fold step
    try {
      const key = this.redisKey(aggregateId, context);
      await this.redis.set(key, JSON.stringify(state), "EX", this.ttlSeconds);
    } catch (error) {
      incrementEsFoldCacheRedisError(this.keyPrefix, "set");
      logger.warn(
        { aggregateId, error: String(error) },
        "Redis SET failed after CH write — next read will fall back to CH",
      );
    }

    const storeDurationMs = performance.now() - storeStartTime;
    observeEsFoldCacheStoreDuration(this.keyPrefix, storeDurationMs);
  }

  private redisKey(aggregateId: string, context: ProjectionStoreContext): string {
    return `fold:${this.keyPrefix}:${String(context.tenantId)}:${aggregateId}`;
  }
}
