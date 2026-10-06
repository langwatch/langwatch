import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";

import type { TraceAnalyticsFoldCacheRepository } from "../trace-analytics-fold-cache.repository.ts";

/** main's keyspace, so a rolling deploy reads the state the previous release cached. */
const TRACE_ANALYTICS_FOLD_CACHE_KEY_PREFIX = "trace_analytics";
/** The five-minute fold class (ARCHITECTURE §7), which is also the replication-lag floor. */
const TRACE_ANALYTICS_FOLD_CACHE_TTL_SECONDS = 300;

export class RedisTraceAnalyticsFoldCacheRepository implements TraceAnalyticsFoldCacheRepository {
  private constructor(private readonly redis: RedisConnection) {}

  static create(redis: RedisConnection): RedisTraceAnalyticsFoldCacheRepository {
    return new RedisTraceAnalyticsFoldCacheRepository(redis);
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return new RedisCachedFoldStore(store, this.redis, {
      keyPrefix: TRACE_ANALYTICS_FOLD_CACHE_KEY_PREFIX,
      ttlSeconds: TRACE_ANALYTICS_FOLD_CACHE_TTL_SECONDS,
    });
  }
}
