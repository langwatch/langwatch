import type { FoldProjectionStore } from "@langwatch/eventing";

import type { EvaluationAnalyticsFoldCacheRepository } from "../evaluation-analytics-fold-cache.repository.ts";

/** No cache tier in memory: the durable store is already as fast as a cache. */
export class MemoryEvaluationAnalyticsFoldCacheRepository implements EvaluationAnalyticsFoldCacheRepository {
  private constructor() {}

  static create(): MemoryEvaluationAnalyticsFoldCacheRepository {
    return new MemoryEvaluationAnalyticsFoldCacheRepository();
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}
