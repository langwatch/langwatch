import { type FoldProjectionStore, RedisCachedFoldStore } from "@langwatch/eventing";
import type { RedisConnection } from "@langwatch/redis-client";

import type { GatewaySpendFoldCacheRepository } from "../gateway-spend-fold-cache.repository.ts";

/** The keyspace main's pipeline registry cached `gateway_spend` under; every role shares it. */
const GATEWAY_SPEND_FOLD_CACHE_KEY_PREFIX = "gateway_spend";

export class RedisGatewaySpendFoldCacheRepository implements GatewaySpendFoldCacheRepository {
  private constructor(private readonly redis: RedisConnection) {}

  static create(redis: RedisConnection): RedisGatewaySpendFoldCacheRepository {
    return new RedisGatewaySpendFoldCacheRepository(redis);
  }

  cached<State>(store: FoldProjectionStore<State>): FoldProjectionStore<State> {
    return new RedisCachedFoldStore(store, this.redis, {
      keyPrefix: GATEWAY_SPEND_FOLD_CACHE_KEY_PREFIX,
    });
  }
}
