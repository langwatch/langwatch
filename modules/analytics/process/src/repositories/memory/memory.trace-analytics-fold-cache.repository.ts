import type { FoldProjectionStore } from "@langwatch/eventing";

import type { TraceAnalyticsFoldCacheRepository } from "../trace-analytics-fold-cache.repository.ts";

/** No cache in memory: the fold reads its durable store directly. */
export class MemoryTraceAnalyticsFoldCacheRepository implements TraceAnalyticsFoldCacheRepository {
  private constructor() {}

  static create(): MemoryTraceAnalyticsFoldCacheRepository {
    return new MemoryTraceAnalyticsFoldCacheRepository();
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}
