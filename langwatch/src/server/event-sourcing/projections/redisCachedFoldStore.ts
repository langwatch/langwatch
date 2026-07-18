import { performance } from "node:perf_hooks";
import { createLogger } from "@langwatch/observability";
import type { Redis } from "ioredis";
import {
  incrementEsFoldCacheRedisError,
  incrementEsFoldCacheTotal,
  observeEsFoldCacheGetDuration,
  observeEsFoldCacheStoreDuration,
} from "~/server/metrics";
import type { FoldProjectionStore } from "./foldProjection.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:redis-cached-fold-store");

export interface RedisCachedFoldStoreOptions {
  keyPrefix: string;
  ttlSeconds?: number;
}

/**
 * Default cache TTL, in seconds. Sized to outlast the processing of a single
 * aggregate's event stream so the fold state stays warm in Redis across
 * consecutive events instead of expiring mid-stream and forcing a ClickHouse
 * fallback read of the (potentially large) state on every event. Matches the
 * queue's activeTtlSec — the upper bound on how long one aggregate stays
 * in-flight.
 *
 * Overridable via LANGWATCH_FOLD_CACHE_TTL_SECONDS when the wrapper is
 * constructed so operators can dial residency down without a redeploy: the
 * fold-cache key set is one entry per aggregate touched within the TTL window,
 * so a longer TTL trades Redis memory for fewer ClickHouse fallback reads.
 * Group-coalescing already collapses an aggregate's in-flight reads to one per
 * batch, so this is a secondary lever, not the primary fix.
 */
function defaultFoldCacheTtlSeconds(): number {
  const raw = process.env.LANGWATCH_FOLD_CACHE_TTL_SECONDS;
  if (raw === undefined || raw === "") return 300;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300;
  return parsed;
}

/**
 * Wraps any FoldProjectionStore with a Redis write-through cache.
 *
 * - get(): Redis first, ClickHouse fallback on miss.
 * - store(): ClickHouse first (throws on failure), then Redis SET.
 *
 * Ordering and cleanup keep both stores consistent across queue retries. The
 * cache must never be left holding PRE-event state after a durable write, or
 * the next event folds onto it and this event is lost:
 * - CH fails → throw → no Redis update → event retried by queue
 * - CH succeeds, Redis SET fails → DEL the stale entry (best effort) → throw
 *   so the queue retries
 *
 * The retry is correct only while the durable read has not yet caught up with
 * the fire-and-forget insert; see the long comment in `store` for the horn
 * this trades against and why event-level idempotency is the real fix.
 */
export class RedisCachedFoldStore<State> implements FoldProjectionStore<State> {
  private readonly ttlSeconds: number;
  private readonly keyPrefix: string;

  constructor(
    private readonly inner: FoldProjectionStore<State>,
    private readonly redis: Redis,
    options: RedisCachedFoldStoreOptions,
  ) {
    this.keyPrefix = options.keyPrefix;
    this.ttlSeconds = options.ttlSeconds ?? defaultFoldCacheTtlSeconds();
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    const key = this.redisKey(aggregateId, context);
    const getStartTime = performance.now();
    let cached: string | null;
    try {
      cached = await this.redis.get(key);
    } catch (_error) {
      incrementEsFoldCacheRedisError(this.keyPrefix, "get");
      incrementEsFoldCacheTotal(this.keyPrefix, "fallback_error");
      // Fall through to inner store
      const innerStartTime = performance.now();
      const result = await this.inner.get(aggregateId, context);
      const innerDurationMs = performance.now() - innerStartTime;
      observeEsFoldCacheGetDuration(
        this.keyPrefix,
        "clickhouse",
        innerDurationMs,
      );
      return result;
    }

    if (cached !== null) {
      const getDurationMs = performance.now() - getStartTime;
      incrementEsFoldCacheTotal(this.keyPrefix, "hit");
      observeEsFoldCacheGetDuration(this.keyPrefix, "redis", getDurationMs);
      return JSON.parse(cached) as State;
    }

    incrementEsFoldCacheTotal(this.keyPrefix, "miss");
    const innerStartTime = performance.now();
    const result = await this.inner.get(aggregateId, context);
    const innerDurationMs = performance.now() - innerStartTime;
    observeEsFoldCacheGetDuration(
      this.keyPrefix,
      "clickhouse",
      innerDurationMs,
    );
    return result;
  }

  async store(state: State, context: ProjectionStoreContext): Promise<void> {
    const aggregateId = context.key ?? context.aggregateId;
    const storeStartTime = performance.now();

    // 1. ClickHouse first — throws on failure, event retried by queue
    await this.inner.store(state, context);

    // 2. Redis second — cache the state for the next fold step.
    //
    // The durable write above has ALREADY COMMITTED here, so a cache write we
    // cannot complete leaves the cache holding PRE-event state. Discard that
    // entry and fail the fold so the queue redelivers.
    //
    // Why fail rather than return once the stale entry is gone: the durable
    // write is fire-and-forget (`async_insert: 1, wait_for_async_insert: 0`,
    // trace-summary.clickhouse.repository.ts), so `inner.store` returning does
    // NOT mean the row is queryable. Returning here would let the NEXT event
    // read a durable store that has not caught up and fold onto pre-event
    // state — silently dropping this event. Failing instead makes the retry
    // re-apply this same event on top of that same pre-event state, landing on
    // the right answer.
    //
    // That is a race, not a proof, and the opposite horn is real: if the
    // durable read HAS caught up by the time the retry runs, the retry loads
    // post-event state and applies the event twice. `apply` is deterministic
    // but not idempotent — traceSummary and traceAnalytics both do
    // `spanCount: state.spanCount + 1` — so that inflates counts and
    // cost/token aggregates.
    //
    // Neither branch is safe in general, and no ordering of SET/DEL/throw
    // makes it safe, because the fold cannot tell a redelivery from a first
    // delivery. Closing this needs event-level idempotency — a durable
    // per-event cursor the executor consults before applying. Until then this
    // takes the horn that self-corrects under the common timing, and the
    // window is only reachable while Redis is actually failing.
    const key = this.redisKey(aggregateId, context);
    try {
      await this.redis.set(key, JSON.stringify(state), "EX", this.ttlSeconds);
    } catch (error) {
      incrementEsFoldCacheRedisError(this.keyPrefix, "set");

      try {
        await this.redis.del(key);
      } catch (deleteError) {
        incrementEsFoldCacheRedisError(this.keyPrefix, "del");
        logger.warn(
          { aggregateId, error: String(deleteError) },
          "Redis DEL failed after SET failure",
        );
      }

      logger.warn(
        { aggregateId, error: String(error) },
        "Redis SET failed after the durable write — fold will retry",
      );
      throw error;
    }

    const storeDurationMs = performance.now() - storeStartTime;
    observeEsFoldCacheStoreDuration(this.keyPrefix, storeDurationMs);
  }

  private redisKey(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): string {
    return `fold:${this.keyPrefix}:${String(context.tenantId)}:${aggregateId}`;
  }
}
