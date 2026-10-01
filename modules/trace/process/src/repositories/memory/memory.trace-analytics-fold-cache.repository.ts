import type { FoldProjectionStore } from "@langwatch/eventing";

import type { TraceAnalyticsFoldCacheRepository } from "../trace-analytics-fold-cache.repository.ts";

/** No cache tier in memory: the durable store is already as fast as a cache. */
export class MemoryTraceAnalyticsFoldCacheRepository implements TraceAnalyticsFoldCacheRepository {
  private constructor() {}

  static create(): MemoryTraceAnalyticsFoldCacheRepository {
    return new MemoryTraceAnalyticsFoldCacheRepository();
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}
