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
 * - CH succeeds, SET fails, DEL succeeds → cache empty → next read falls back
 *   to CH → return normally (throwing here would double-apply the event)
 * - CH succeeds, SET fails, DEL fails → cache may hold stale state → throw so
 *   the queue retries off it
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
    // The durable write above has ALREADY COMMITTED by this point, so whether
    // we throw here decides what the queue's retry will re-apply. That makes
    // the two failure branches below genuinely different, and neither can be
    // collapsed into the other:
    //
    // - DEL succeeded: the cache is now empty, so the next read falls back to
    //   ClickHouse and gets the correct post-event state. Everything is
    //   consistent — DO NOT throw. Throwing would make the queue redeliver the
    //   event, and the retry would load the already-post-event state and apply
    //   the event a SECOND time. `apply` is deterministic but not idempotent
    //   (traceSummary/traceAnalytics do `spanCount: state.spanCount + 1`), so
    //   that inflates counts and cost/token aggregates.
    //
    // - DEL failed: a stale PRE-event entry may still be in the cache, and the
    //   next read would silently fold the following event onto it, dropping
    //   this event. Throw so the queue retries: the retry reads that same stale
    //   pre-event state and applies the event once, converging correctly.
    const key = this.redisKey(aggregateId, context);
    try {
      await this.redis.set(key, JSON.stringify(state), "EX", this.ttlSeconds);
    } catch (error) {
      incrementEsFoldCacheRedisError(this.keyPrefix, "set");

      try {
        await this.redis.del(key);
      } catch (deleteError) {
        incrementEsFoldCacheRedisError(this.keyPrefix, "del");
        logger.error(
          { aggregateId, error: String(deleteError), setError: String(error) },
          "Redis SET and DEL both failed after the durable write — failing the fold so the queue retries off the surviving cache entry",
        );
        // Residual risk, accepted knowingly: if the SET actually landed and
        // only its acknowledgement was lost, the surviving entry is the
        // POST-event state and the retry double-applies. Closing that window
        // needs event-level idempotency (a durable per-event cursor consulted
        // by the executor), which is a larger change than this store — tracked
        // as follow-up. Dropping the event is the worse of the two risks, so
        // this path still throws.
        throw error;
      }

      logger.warn(
        { aggregateId, error: String(error) },
        "Redis SET failed after the durable write — cache entry dropped, next read falls back to the durable store",
      );
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
