import { performance } from "node:perf_hooks";
import { createLogger } from "@langwatch/observability";
import type { Redis } from "ioredis";
import {
  incrementEsFoldCacheRedisError,
  incrementEsFoldCacheTotal,
  observeEsFoldCacheEntryBytes,
  observeEsFoldCacheGetDuration,
  observeEsFoldCacheStoreDuration,
} from "~/server/metrics";
import type { FoldProjectionStore } from "./foldProjection.types";
import {
  decodeFoldCacheEntry,
  encodeFoldCacheEntry,
  mergeAppliedEventIds,
} from "./foldCache/foldCacheEntry";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:redis-cached-fold-store");

export interface RedisCachedFoldStoreOptions<State = unknown> {
  keyPrefix: string;
  ttlSeconds?: number;
  /**
   * Reads the state's own version, recorded on the entry. Defaults to the
   * `UpdatedAt` field, which `AbstractFoldProjection` maintains as strictly
   * increasing per apply.
   */
  updatedAtOf?: (state: State) => number;
}

/**
 * Default cache TTL, in seconds. Sized to outlast the processing of a single
 * aggregate's event stream so the fold state stays warm across consecutive
 * events instead of expiring mid-stream and forcing a durable read of the
 * (potentially large) state on every event.
 *
 * Overridable via LANGWATCH_FOLD_CACHE_TTL_SECONDS, read at call time so
 * operators can dial residency down without a redeploy.
 */
function defaultFoldCacheTtlSeconds(): number {
  const raw = process.env.LANGWATCH_FOLD_CACHE_TTL_SECONDS;
  if (raw === undefined || raw === "") return 300;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 300;
  return parsed;
}

function readUpdatedAt<State>(state: State): number {
  const value = (state as { UpdatedAt?: unknown })?.UpdatedAt;
  return typeof value === "number" ? value : Date.now();
}

/**
 * Wraps a fold store with a Redis write-through cache.
 *
 * - `get()`: Redis first, durable store on miss.
 * - `store()`: durable store first (throws on failure), then the cache.
 *
 * The entry also carries the ids of the events folded into it. Queue delivery
 * is at-least-once, so a fold job that fails after its state was stored is
 * re-dispatched with the same events; most fold handlers accumulate (counters,
 * sums, appends) rather than being idempotent, and would double-count. The
 * executor uses that set to recognise and skip a redelivery.
 *
 * The set is deliberately NOT a durability mechanism. It lives in the cache
 * entry, so eviction or Redis loss takes it with them — which degrades to the
 * behaviour that existed before it, not to something worse. Closing the cold
 * path properly means making the folds themselves idempotent; see
 * dev/docs/plans/fold-idempotency-plan.md.
 */
export class RedisCachedFoldStore<State>
  implements FoldProjectionStore<State>
{
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly updatedAtOf: (state: State) => number;

  constructor(
    private readonly inner: FoldProjectionStore<State>,
    private readonly redis: Redis,
    options: RedisCachedFoldStoreOptions<State>,
  ) {
    this.keyPrefix = options.keyPrefix;
    this.ttlSeconds = options.ttlSeconds ?? defaultFoldCacheTtlSeconds();
    this.updatedAtOf = options.updatedAtOf ?? readUpdatedAt;
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
  }

  /**
   * The state together with the ids already folded into it. On a miss the set
   * is empty — there is no cached state to have applied anything to.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{ state: State | null; appliedEventIds: string[] }> {
    const cached = await this.readCached(aggregateId, context);
    if (cached) {
      return {
        state: cached.state,
        appliedEventIds: cached.appliedEventIds,
      };
    }
    return {
      state: await this.readDurable(aggregateId, context),
      appliedEventIds: [],
    };
  }

  private async readCached(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{ state: State; appliedEventIds: string[] } | null> {
    const key = this.redisKey(aggregateId, context);
    const startedAt = performance.now();

    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (error) {
      incrementEsFoldCacheRedisError(this.keyPrefix, "get");
      incrementEsFoldCacheTotal(this.keyPrefix, "fallback_error");
      logger.warn(
        { aggregateId, error: String(error) },
        "Fold cache read failed — falling through to the durable store",
      );
      return null;
    }

    if (raw === null) {
      incrementEsFoldCacheTotal(this.keyPrefix, "miss");
      return null;
    }

    incrementEsFoldCacheTotal(this.keyPrefix, "hit");
    observeEsFoldCacheGetDuration(
      this.keyPrefix,
      "redis",
      performance.now() - startedAt,
    );

    const decoded = decodeFoldCacheEntry<State>(raw);
    return {
      state: decoded.state,
      appliedEventIds: decoded.appliedEventIds,
    };
  }

  private async readDurable(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    const startedAt = performance.now();
    const result = await this.inner.get(aggregateId, context);
    observeEsFoldCacheGetDuration(
      this.keyPrefix,
      "clickhouse",
      performance.now() - startedAt,
    );
    return result;
  }

  async store(state: State, context: ProjectionStoreContext): Promise<void> {
    const aggregateId = context.key ?? context.aggregateId;
    const startedAt = performance.now();

    await this.inner.store(state, context);
    await this.cache(state, aggregateId, context);

    observeEsFoldCacheStoreDuration(
      this.keyPrefix,
      performance.now() - startedAt,
    );
  }

  /**
   * A cache write failure is logged, not thrown: the durable write above
   * already succeeded, so the next read falls through to state that is
   * genuinely there. What is lost is the read-your-writes window and the
   * applied-set, so it is counted rather than swallowed silently.
   */
  private async cache(
    state: State,
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const key = this.redisKey(aggregateId, context);

    try {
      const applied = context.appliedEventIds ?? [];
      // A fresh delivery means the previous batch for this group acked, so the
      // ids it recorded can never come back — carrying them forward is what
      // made the set grow to dwarf the state it sits next to. During a retry
      // chain they are still live and must be kept, or a later attempt
      // re-applies what an earlier one already folded.
      const isRetry = (context.deliveryAttempt ?? 1) > 1;
      const previous = isRetry ? await this.readCachedAppliedIds(key) : [];

      const payload = encodeFoldCacheEntry({
        state,
        updatedAt: this.updatedAtOf(state),
        appliedEventIds: isRetry
          ? mergeAppliedEventIds({ previous, applied })
          : applied,
      });

      observeEsFoldCacheEntryBytes(this.keyPrefix, Buffer.byteLength(payload));
      await this.redis.set(key, payload, "EX", this.ttlSeconds);
    } catch (error) {
      incrementEsFoldCacheRedisError(this.keyPrefix, "set");
      logger.warn(
        { aggregateId, error: String(error) },
        "Fold cache write failed after the durable write — reads fall through to the durable store",
      );
    }
  }

  private async readCachedAppliedIds(key: string): Promise<string[]> {
    const raw = await this.redis.get(key);
    if (raw === null) return [];
    return decodeFoldCacheEntry<State>(raw).appliedEventIds;
  }

  private redisKey(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): string {
    return `fold:${this.keyPrefix}:${String(context.tenantId)}:${aggregateId}`;
  }
}
