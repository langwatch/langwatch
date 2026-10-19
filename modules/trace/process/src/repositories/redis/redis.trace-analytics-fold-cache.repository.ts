import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";

import type { TraceAnalyticsFoldCacheRepository } from "../trace-analytics-fold-cache.repository.ts";

/** main's keyspace, so a rolling deploy reads the state the previous release cached. */
const TRACE_ANALYTICS_FOLD_CACHE_KEY_PREFIX = "trace_analytics";

export class RedisTraceAnalyticsFoldCacheRepository implements TraceAnalyticsFoldCacheRepository {
  private constructor(
    private readonly redis: RedisConnection,
    private readonly ttlSeconds: number,
  ) {}

  /** `ttlSeconds` is the module's `foldCacheTtlSeconds` leaf, handed in by its live tier. */
  static create({
    redis,
    ttlSeconds,
  }: Readonly<{
    redis: RedisConnection;
    ttlSeconds: number;
  }>): RedisTraceAnalyticsFoldCacheRepository {
    return new RedisTraceAnalyticsFoldCacheRepository(redis, ttlSeconds);
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return new RedisCachedFoldStore(store, this.redis, {
      keyPrefix: TRACE_ANALYTICS_FOLD_CACHE_KEY_PREFIX,
      ttlSeconds: this.ttlSeconds,
    });
  }
}
