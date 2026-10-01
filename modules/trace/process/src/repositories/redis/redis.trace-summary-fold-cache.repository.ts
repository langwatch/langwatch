import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { ProcessMembers } from "@langwatch/process-stores/members";

import type { TraceSummaryFoldCacheRepository } from "../trace-summary-fold-cache.repository.ts";

/** main's keyspace, so a rolling deploy reads the state the previous release cached. */
const TRACE_SUMMARY_FOLD_CACHE_KEY_PREFIX = "trace_summaries";
/** The five-minute fold class (ARCHITECTURE §7), which is also the replication-lag floor. */
const TRACE_SUMMARY_FOLD_CACHE_TTL_SECONDS = 300;

export class RedisTraceSummaryFoldCacheRepository implements TraceSummaryFoldCacheRepository {
  private constructor(private readonly redis: ProcessMembers["redis"]) {}

  static create(redis: ProcessMembers["redis"]): RedisTraceSummaryFoldCacheRepository {
    return new RedisTraceSummaryFoldCacheRepository(redis);
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return new RedisCachedFoldStore(store, this.redis, {
      keyPrefix: TRACE_SUMMARY_FOLD_CACHE_KEY_PREFIX,
      ttlSeconds: TRACE_SUMMARY_FOLD_CACHE_TTL_SECONDS,
    });
  }
}
