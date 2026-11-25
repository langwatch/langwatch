import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";

import type { TraceSummaryFoldCacheRepository } from "../trace-summary-fold-cache.repository.ts";

/** main's keyspace, so a rolling deploy reads the state the previous release cached. */
const TRACE_SUMMARY_FOLD_CACHE_KEY_PREFIX = "trace_summaries";

export class RedisTraceSummaryFoldCacheRepository implements TraceSummaryFoldCacheRepository {
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
  }>): RedisTraceSummaryFoldCacheRepository {
    return new RedisTraceSummaryFoldCacheRepository(redis, ttlSeconds);
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return new RedisCachedFoldStore(store, this.redis, {
      keyPrefix: TRACE_SUMMARY_FOLD_CACHE_KEY_PREFIX,
      ttlSeconds: this.ttlSeconds,
    });
  }
}
