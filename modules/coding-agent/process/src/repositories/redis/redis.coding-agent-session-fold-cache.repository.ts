import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { Cluster, Redis } from "ioredis";

import type { CodingAgentSessionFoldCacheRepository } from "../coding-agent-session-fold-cache.repository.ts";

/** One keyspace for every process that folds or reads a session. */
const SESSION_FOLD_CACHE_KEY_PREFIX = "coding_agent_sessions";

export class RedisCodingAgentSessionFoldCacheRepository implements CodingAgentSessionFoldCacheRepository {
  private constructor(
    private readonly redis: Redis | Cluster,
    private readonly ttlSeconds: number,
  ) {}

  /** `ttlSeconds` is the module's `foldCacheTtlSeconds` leaf, handed in by its live tier. */
  static create({
    redis,
    ttlSeconds,
  }: {
    redis: Redis | Cluster;
    ttlSeconds: number;
  }): RedisCodingAgentSessionFoldCacheRepository {
    return new RedisCodingAgentSessionFoldCacheRepository(redis, ttlSeconds);
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return new RedisCachedFoldStore(store, this.redis, {
      keyPrefix: SESSION_FOLD_CACHE_KEY_PREFIX,
      ttlSeconds: this.ttlSeconds,
    });
  }
}
