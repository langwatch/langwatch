import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { Cluster, Redis } from "ioredis";

import type { CodingAgentSessionFoldCacheRepository } from "../coding-agent-session-fold-cache.repository.ts";

/** One keyspace for every process that folds or reads a session. */
const SESSION_FOLD_CACHE_KEY_PREFIX = "coding_agent_sessions";

export class RedisCodingAgentSessionFoldCacheRepository implements CodingAgentSessionFoldCacheRepository {
  private constructor(private readonly redis: Redis | Cluster) {}

  static create(redis: Redis | Cluster): RedisCodingAgentSessionFoldCacheRepository {
    return new RedisCodingAgentSessionFoldCacheRepository(redis);
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return new RedisCachedFoldStore(store, this.redis, {
      keyPrefix: SESSION_FOLD_CACHE_KEY_PREFIX,
    });
  }
}
