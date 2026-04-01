import type { Redis } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import type { FoldProjectionStore } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:redis-cached-fold-store");

export interface RedisCachedFoldStoreOptions {
  keyPrefix: string;
  ttlSeconds?: number;
}

/**
 * Wraps any FoldProjectionStore with a Redis write-through cache.
 *
 * - get(): Redis first, ClickHouse fallback on miss.
 * - store(): ClickHouse first (throws on failure), then Redis SET (cache).
 *
 * Ordering guarantees correctness without transactions:
 * - CH fails → throw → no Redis update → event retried by queue
 * - CH succeeds, Redis fails → next read falls back to CH
 */
export class RedisCachedFoldStore<State>
  implements FoldProjectionStore<State>
{
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;

  constructor(
    private readonly inner: FoldProjectionStore<State>,
    private readonly redis: Redis,
    options: RedisCachedFoldStoreOptions,
  ) {
    this.keyPrefix = options.keyPrefix;
    this.ttlSeconds = options.ttlSeconds ?? 30;
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    const key = this.redisKey(aggregateId, context);
    const cached = await this.redis.get(key);
    if (cached !== null) {
      return JSON.parse(cached) as State;
    }

    return this.inner.get(aggregateId, context);
  }

  async store(
    state: State,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const aggregateId = context.key ?? context.aggregateId;

    // 1. ClickHouse first — throws on failure, event retried by queue
    await this.inner.store(state, context);

    // 2. Redis second — cache for fast reads on next fold step
    try {
      const key = this.redisKey(aggregateId, context);
      await this.redis.set(key, JSON.stringify(state), "EX", this.ttlSeconds);
    } catch (error) {
      logger.warn(
        { aggregateId, error: String(error) },
        "Redis SET failed after CH write — next read will fall back to CH",
      );
    }
  }

  private redisKey(aggregateId: string, context: ProjectionStoreContext): string {
    return `fold:${this.keyPrefix}:${String(context.tenantId)}:${aggregateId}`;
  }
}
