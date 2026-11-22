import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";

import type { EvaluationAnalyticsFoldCacheRepository } from "../evaluation-analytics-fold-cache.repository.ts";

/** One keyspace for every process that folds or reads an evaluation's analytics. */
const EVALUATION_ANALYTICS_FOLD_CACHE_KEY_PREFIX = "evaluation_analytics";

export class RedisEvaluationAnalyticsFoldCacheRepository implements EvaluationAnalyticsFoldCacheRepository {
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
  }>): RedisEvaluationAnalyticsFoldCacheRepository {
    return new RedisEvaluationAnalyticsFoldCacheRepository(redis, ttlSeconds);
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return new RedisCachedFoldStore(store, this.redis, {
      keyPrefix: EVALUATION_ANALYTICS_FOLD_CACHE_KEY_PREFIX,
      ttlSeconds: this.ttlSeconds,
    });
  }
}
