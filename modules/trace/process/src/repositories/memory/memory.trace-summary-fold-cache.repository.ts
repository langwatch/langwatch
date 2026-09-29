import type { FoldProjectionStore } from "@langwatch/eventing";

import type { TraceSummaryFoldCacheRepository } from "../trace-summary-fold-cache.repository.ts";

/** No cache tier in memory: the durable store is already as fast as a cache. */
export class MemoryTraceSummaryFoldCacheRepository implements TraceSummaryFoldCacheRepository {
  private constructor() {}

  static create(): MemoryTraceSummaryFoldCacheRepository {
    return new MemoryTraceSummaryFoldCacheRepository();
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}
