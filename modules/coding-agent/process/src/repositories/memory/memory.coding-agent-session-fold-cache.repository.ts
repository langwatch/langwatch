import type { FoldProjectionStore } from "@langwatch/eventing";

import type { CodingAgentSessionFoldCacheRepository } from "../coding-agent-session-fold-cache.repository.ts";

/** No cache tier in memory: the durable store is already as fast as a cache. */
export class MemoryCodingAgentSessionFoldCacheRepository implements CodingAgentSessionFoldCacheRepository {
  private constructor() {}

  static create(): MemoryCodingAgentSessionFoldCacheRepository {
    return new MemoryCodingAgentSessionFoldCacheRepository();
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return store;
  }
}
