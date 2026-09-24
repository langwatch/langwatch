import { performance } from "node:perf_hooks";

import { createLogger } from "@langwatch/observability";
import { nowInstant } from "@langwatch/time";
import type { Cluster, Redis } from "ioredis";

import {
  incrementEsFoldCacheRedisError,
  incrementEsFoldCacheTotal,
  incrementEsFoldDedupUnavailable,
  observeEsFoldCacheEntryBytes,
  observeEsFoldCacheGetDuration,
  observeEsFoldCacheStoreDuration,
} from "../metrics.ts";
import { decodeFoldCacheEntry, encodeFoldCacheEntry } from "./foldCache/foldCacheEntry.ts";
import type { FoldProjectionStore, FoldStateRead } from "./foldProjection.types.ts";
import type { ProjectionStoreContext } from "./projectionStoreContext.ts";

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
 * Fold cache TTL is a correctness invariant: must stay >= max cross-replica
 * replication lag (5 min). Ensures settled reads for read-your-write
 * consistency.
 */
const FOLD_CACHE_REPLICATION_LAG_SECONDS = 300;
const DEFAULT_FOLD_CACHE_TTL_SECONDS = FOLD_CACHE_REPLICATION_LAG_SECONDS;
const MIN_FOLD_CACHE_TTL_SECONDS = FOLD_CACHE_REPLICATION_LAG_SECONDS;

/**
 * The TTL is resolved on every construction (and thus potentially every fold
 * step), so a below-floor override would log per call. Warn once per process
 * instead — the misconfiguration is static, one loud line is enough.
 */
let ttlFloorClampWarned = false;

/**
 * Resolves the process-injected cache TTL, clamped up to the replication-lag
 * floor so an override can never silently drop below the correctness invariant.
 */
function resolveFoldCacheTtlSeconds(configuredSeconds: number | undefined): number {
  const configured = configuredSeconds ?? DEFAULT_FOLD_CACHE_TTL_SECONDS;
  if (!Number.isFinite(configured)) {
    return DEFAULT_FOLD_CACHE_TTL_SECONDS;
  }

  if (configured < MIN_FOLD_CACHE_TTL_SECONDS) {
    if (!ttlFloorClampWarned) {
      ttlFloorClampWarned = true;
      logger.warn(
        {
          configuredSeconds: configured,
          floorSeconds: MIN_FOLD_CACHE_TTL_SECONDS,
        },
        "Configured fold cache TTL is below the replication-lag floor — clamping up; a TTL under the floor breaks the fold cache's read-your-write consistency guarantee (ADR-066)",
      );
    }
    return MIN_FOLD_CACHE_TTL_SECONDS;
  }
  return configured;
}

function readUpdatedAt<State>(state: State): number {
  const value = (state as { UpdatedAt?: unknown })?.UpdatedAt;
  return typeof value === "number" ? value : nowInstant().epochMilliseconds;
}

/**
 * Redis write-through cache wrapper: get() tries cache first; store() durable
 * first. Entry carries applied event ids for dedup. Cache is fast tier; if
 * inner implements getWithApplied, set is persisted durably.
 */
export class RedisCachedFoldStore<State> implements FoldProjectionStore<State> {
  private readonly keyPrefix: string;
  private readonly ttlSeconds: number;
  private readonly updatedAtOf: (state: State) => number;

  constructor(
    private readonly inner: FoldProjectionStore<State>,
    private readonly redis: Redis | Cluster,
    options: RedisCachedFoldStoreOptions<State>,
  ) {
    this.keyPrefix = options.keyPrefix;
    this.ttlSeconds = resolveFoldCacheTtlSeconds(options.ttlSeconds);
    this.updatedAtOf = options.updatedAtOf ?? readUpdatedAt;
  }

  async get(aggregateId: string, context: ProjectionStoreContext): Promise<FoldStateRead<State>> {
    const { state } = await this.getWithApplied(aggregateId, context);
    return state === null ? { kind: "empty" } : { kind: "folded", state };
  }

  /**
   * The state together with the ids already folded into it. A cache hit serves
   * both; a miss falls through to the durable store, which carries the
   * applied-set too when it implements `getWithApplied`.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: State | null;
    appliedEventIds: string[];
    /**
     * Forwarded verbatim from the durable tier. DECLARED, not incidental: every
     * ADR-066 adopter depends on this field reaching the executor, and leaving
     * it undeclared would silently disable that on a routine field refactor.
     */
    miss?: "absent" | "undecodable";
  }> {
    // The executor's read-window fallback re-reads moments after its windowed
    // attempt already consulted the cache — a second Redis read is a
    // guaranteed miss, so the retry goes straight to the durable tier without
    // re-counting dedup-unavailable (the windowed attempt already did).
    if (context.bypassReadCache) {
      return this.readDurable(aggregateId, context);
    }

    const cached = await this.readCached(aggregateId, context);
    const isRetry = (context.deliveryAttempt ?? 1) > 1;

    if (cached.hit) {
      if (isRetry && cached.legacy) {
        incrementEsFoldDedupUnavailable(this.keyPrefix, "legacy_entry");
      }
      return {
        state: cached.state,
        appliedEventIds: cached.appliedEventIds,
      };
    }

    // A retry with no applied-set is the moment a batch gets re-applied on top
    // of state that already holds it. A durable store that persists the set
    // next to its row can still answer, though — so only count dedup as
    // unavailable when even that came back empty. Named by reason so an incident
    // can tell a cold cache from a Redis fault from a corrupt entry.
    const durable = await this.readDurable(aggregateId, context);
    if (isRetry && durable.appliedEventIds.length === 0) {
      incrementEsFoldDedupUnavailable(this.keyPrefix, cached.reason);
    }

    return durable;
  }

  private async readCached(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<
    | { hit: true; state: State; appliedEventIds: string[]; legacy: boolean }
    | { hit: false; reason: "cache_miss" | "read_error" | "unreadable" }
  > {
    const key = this.redisKey(aggregateId, context);
    const startedAt = performance.now();

    let raw: string | null;
    try {
      raw = await this.redis.get(key);
    } catch (error) {
      incrementEsFoldCacheRedisError(this.keyPrefix, "get");
      incrementEsFoldCacheTotal(this.keyPrefix, "fallback_error");
      logger.warn(
        {
          aggregateId,
          tenantId: String(context.tenantId),
          error: String(error),
        },
        "Fold cache read failed — falling through to the durable store",
      );
      return { hit: false, reason: "read_error" };
    }

    if (raw === null) {
      incrementEsFoldCacheTotal(this.keyPrefix, "miss");
      return { hit: false, reason: "cache_miss" };
    }

    incrementEsFoldCacheTotal(this.keyPrefix, "hit");
    observeEsFoldCacheGetDuration(this.keyPrefix, "redis", performance.now() - startedAt);

    let decoded: ReturnType<typeof decodeFoldCacheEntry<State>>;
    try {
      decoded = decodeFoldCacheEntry<State>(raw);
    } catch (error) {
      // An unreadable entry is not a reason to fail the fold: the durable store
      // still holds the state. Treated as a miss so the read falls through —
      // but counted, because it also loses the applied-set, and a redelivery
      // against a lost set double-counts.
      incrementEsFoldCacheRedisError(this.keyPrefix, "get");
      incrementEsFoldCacheTotal(this.keyPrefix, "fallback_error");
      logger.error(
        {
          aggregateId,
          tenantId: String(context.tenantId),
          error: String(error),
        },
        "Fold cache entry was unreadable — falling through to the durable store, dedup unavailable for this read",
      );
      return { hit: false, reason: "unreadable" };
    }

    return {
      hit: true,
      state: decoded.state,
      appliedEventIds: decoded.appliedEventIds,
      // Written before the applied-set existed: readable, but carries no record
      // of what was applied.
      legacy: decoded.updatedAt === null,
    };
  }

  /**
   * The durable read behind a cache miss. A store that persists the
   * applied-event-id set (`getWithApplied`) lets a cold-cache retry still
   * recognise a committed batch; otherwise dedup falls back to blind re-apply.
   */
  private async readDurable(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: State | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }> {
    const startedAt = performance.now();
    const result = this.inner.getWithApplied
      ? await this.inner.getWithApplied(aggregateId, context)
      : await this.readInnerState(aggregateId, context);
    observeEsFoldCacheGetDuration(this.keyPrefix, "clickhouse", performance.now() - startedAt);
    return result;
  }

  private async readInnerState(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{ state: State | null; appliedEventIds: string[] }> {
    const read = await this.inner.get(aggregateId, context);
    return { state: read.kind === "folded" ? read.state : null, appliedEventIds: [] };
  }

  async store(state: State, context: ProjectionStoreContext): Promise<void> {
    const aggregateId = context.key ?? context.aggregateId;
    const startedAt = performance.now();

    await this.inner.store(state, context);
    await this.cache(state, aggregateId, context);

    observeEsFoldCacheStoreDuration(this.keyPrefix, performance.now() - startedAt);
  }

  /**
   * A cache write failure is logged, not thrown: the durable write already
   * succeeded, so the next read falls through to state that is genuinely
   * there. The loss (read-your-writes window, applied-set) is counted.
   */
  private async cache(
    state: State,
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const key = this.redisKey(aggregateId, context);

    try {
      // Applied-event-id set is stamped on context by upstream executor (unions
      // on retry, resets on fresh). Cache persists it verbatim (dumb tier).
      const payload = encodeFoldCacheEntry({
        state,
        updatedAt: this.updatedAtOf(state),
        appliedEventIds: context.appliedEventIds ?? [],
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

  private redisKey(aggregateId: string, context: ProjectionStoreContext): string {
    return `fold:${this.keyPrefix}:${String(context.tenantId)}:${aggregateId}`;
  }
}
