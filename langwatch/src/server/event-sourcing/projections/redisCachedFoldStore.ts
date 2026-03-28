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
 * - store(): Redis SET (commit point) → ClickHouse INSERT fire-and-forget.
 * - On ClickHouse write failure: calls the bound replay function.
 *
 * Call `bindReplay()` after pipeline registration to wire the replay
 * (same late-binding pattern as dispatchers in PipelineRegistry).
 */
export class RedisCachedFoldStore<State>
  implements FoldProjectionStore<State>
{
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;
  private replayFn: ((aggregateId: string, tenantId: string) => Promise<void>) | null = null;

  constructor(
    private readonly inner: FoldProjectionStore<State>,
    private readonly redis: Redis,
    options: RedisCachedFoldStoreOptions,
  ) {
    this.keyPrefix = options.keyPrefix;
    this.ttlSeconds = options.ttlSeconds ?? 30;
  }

  /**
   * Late-bind the replay function. Called after pipeline registration
   * when the projection definition is available for replay.
   */
  bindReplay(fn: (aggregateId: string, tenantId: string) => Promise<void>): void {
    this.replayFn = fn;
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    const key = this.redisKey(aggregateId);
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
    const key = this.redisKey(aggregateId);

    // 1. Commit to Redis (fast, consistent for next fold step)
    await this.redis.set(key, JSON.stringify(state), "EX", this.ttlSeconds);

    // 2. Fire-and-forget to inner (ClickHouse) store
    this.inner.store(state, context).catch((error) => {
      logger.error(
        { aggregateId, tenantId: String(context.tenantId), error: String(error) },
        "ClickHouse write failed, triggering replay from event log",
      );

      if (!this.replayFn) {
        logger.error({ aggregateId }, "Cannot replay: bindReplay() not called");
        return;
      }

      this.replayFn(aggregateId, String(context.tenantId)).catch((replayError) => {
        logger.error(
          { aggregateId, error: String(replayError) },
          "Fold replay also failed",
        );
      });
    });
  }

  private redisKey(aggregateId: string): string {
    return `fold:${this.keyPrefix}:${aggregateId}`;
  }
}
