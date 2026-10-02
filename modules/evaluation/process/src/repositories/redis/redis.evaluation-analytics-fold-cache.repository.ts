import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { ProcessMembers } from "@langwatch/process-stores/members";

import type { EvaluationAnalyticsFoldCacheRepository } from "../evaluation-analytics-fold-cache.repository.ts";

/** One keyspace for every process that folds or reads an evaluation's analytics. */
const EVALUATION_ANALYTICS_FOLD_CACHE_KEY_PREFIX = "evaluation_analytics";
/** The five-minute fold class (ARCHITECTURE §7), which is also the replication-lag floor. */
const EVALUATION_ANALYTICS_FOLD_CACHE_TTL_SECONDS = 300;

export class RedisEvaluationAnalyticsFoldCacheRepository implements EvaluationAnalyticsFoldCacheRepository {
  private constructor(private readonly redis: ProcessMembers["redis"]) {}

  static create(redis: ProcessMembers["redis"]): RedisEvaluationAnalyticsFoldCacheRepository {
    return new RedisEvaluationAnalyticsFoldCacheRepository(redis);
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return new RedisCachedFoldStore(store, this.redis, {
      keyPrefix: EVALUATION_ANALYTICS_FOLD_CACHE_KEY_PREFIX,
      ttlSeconds: EVALUATION_ANALYTICS_FOLD_CACHE_TTL_SECONDS,
    });
  }
}
