import type { FoldProjectionStore } from "@langwatch/eventing";

import type { GatewaySpendFoldCacheRepository } from "../gateway-spend-fold-cache.repository.ts";

/** No cache tier in memory: the durable store is already as fast as a cache. */
export class MemoryGatewaySpendFoldCacheRepository implements GatewaySpendFoldCacheRepository {
  static create(): MemoryGatewaySpendFoldCacheRepository {
    return new MemoryGatewaySpendFoldCacheRepository();
  }

  private constructor() {}

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}
