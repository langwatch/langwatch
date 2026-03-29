import type { Redis } from "ioredis";
import { createLogger } from "~/utils/logger/server";
import type { FoldProjectionStore } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:redis-cached-fold-store");

const LOCK_TTL_MS = 5000;
const LOCK_RETRY_DELAY_MS = 10;
const LOCK_MAX_RETRIES = 500; // 5s total

export interface RedisCachedFoldStoreOptions {
  keyPrefix: string;
  ttlSeconds?: number;
}

/**
 * Wraps any FoldProjectionStore with a Redis write-through cache.
 *
 * - get(): Acquires a per-aggregate lock, then Redis GET → ClickHouse fallback.
 * - store(): Redis SET (commit point) → ClickHouse fire-and-forget → releases lock.
 * - On ClickHouse write failure: calls the bound replay function.
 *
 * The lock ensures that parallel commands with different getGroupKey
 * (e.g., experiment run results for different item indices) don't race
 * on the same aggregate's fold state. The lock spans the entire
 * get → apply → store cycle (acquired in get, released in store).
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

  bindReplay(fn: (aggregateId: string, tenantId: string) => Promise<void>): void {
    this.replayFn = fn;
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    // Acquire per-aggregate lock before reading — held until store() releases it.
    // This serializes the get → apply → store cycle for parallel commands
    // operating on the same aggregate (e.g., getGroupKey parallelism).
    await this.acquireLock(aggregateId);

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

    try {
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
    } finally {
      // Always release the lock, even if Redis SET fails
      await this.releaseLock(aggregateId);
    }
  }

  private async acquireLock(aggregateId: string): Promise<void> {
    const lockKey = this.lockKey(aggregateId);
    for (let i = 0; i < LOCK_MAX_RETRIES; i++) {
      const acquired = await this.redis.set(
        lockKey, "1", "PX", LOCK_TTL_MS, "NX",
      );
      if (acquired === "OK") return;
      await new Promise((r) => setTimeout(r, LOCK_RETRY_DELAY_MS));
    }
    // Lock timeout — proceed anyway to avoid deadlock.
    // The lock has a TTL so it will self-heal.
    logger.warn({ aggregateId }, "Fold lock acquisition timed out, proceeding without lock");
  }

  private async releaseLock(aggregateId: string): Promise<void> {
    await this.redis.del(this.lockKey(aggregateId));
  }

  private redisKey(aggregateId: string): string {
    return `fold:${this.keyPrefix}:${aggregateId}`;
  }

  private lockKey(aggregateId: string): string {
    return `fold:lock:${this.keyPrefix}:${aggregateId}`;
  }
}
