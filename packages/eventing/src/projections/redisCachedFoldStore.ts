import { performance } from "node:perf_hooks";
import { createLogger } from "@langwatch/observability";
import type { Cluster, Redis } from "ioredis";
import {
  incrementEsFoldCacheRedisError,
  incrementEsFoldCacheTotal,
  incrementEsFoldDedupUnavailable,
  observeEsFoldCacheEntryBytes,
  observeEsFoldCacheGetDuration,
  observeEsFoldCacheStoreDuration,
} from "../metrics";
import { decodeFoldCacheEntry, encodeFoldCacheEntry } from "./foldCache/foldCacheEntry";
import type { FoldProjectionStore } from "./foldProjection.types";
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
 * The fold cache TTL is a correctness invariant, not a latency knob. A cache
 * miss is treated as authoritative only because it means the last write is at
 * least a TTL old and has therefore settled across the ClickHouse replicas, so
 * the TTL MUST stay >= the maximum cross-replica replication lag — the fold
 * cache is the event processor's read-your-write consistency layer (ADR-066).
 *
 * The replication assumption today is 5 minutes, which is BOTH the default and
 * the floor. Raising the TTL only ever adds settle margin and is always safe;
 * dropping it below the replication lag is a correctness bug, so a configured
 * override below the floor is clamped up to it rather than honoured. The default
 * therefore equals the floor, and the override can only raise the TTL.
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
 * Resolves the cache TTL from LANGWATCH_FOLD_CACHE_TTL_SECONDS, read at call
 * time so operators can raise residency without a redeploy, clamped up to the
 * replication-lag floor so an override can never silently drop below the
 * correctness invariant. Unset, empty, or unparseable falls back to the default
 * (which already sits at the floor).
 */
function resolveFoldCacheTtlSeconds(): number {
  const raw = process.env.LANGWATCH_FOLD_CACHE_TTL_SECONDS;
  if (raw === undefined || raw === "") return DEFAULT_FOLD_CACHE_TTL_SECONDS;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_FOLD_CACHE_TTL_SECONDS;

  if (parsed < MIN_FOLD_CACHE_TTL_SECONDS) {
    if (!ttlFloorClampWarned) {
      ttlFloorClampWarned = true;
      logger.warn(
        {
          configuredSeconds: parsed,
          floorSeconds: MIN_FOLD_CACHE_TTL_SECONDS,
          env: "LANGWATCH_FOLD_CACHE_TTL_SECONDS",
        },
        "Configured fold cache TTL is below the replication-lag floor — clamping up; a TTL under the floor breaks the fold cache's read-your-write consistency guarantee (ADR-066)",
      );
    }
    return MIN_FOLD_CACHE_TTL_SECONDS;
  }
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
 * The cache is the FAST tier for that set, not the only one. When the inner
 * store implements `getWithApplied` (first adopter: the codingAgentSession
 * ClickHouse store) it also persists the set durably alongside the state row,
 * and this wrapper reads it back on a cache miss — so a retry that reaches a
 * cold cache still recognises a batch it already committed, closing the
 * cold-cache redelivery double-count. An inner store without `getWithApplied`
 * keeps the pre-durable behaviour: eviction or Redis loss drops the set,
 * degrading to a blind re-apply, not to something worse.
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
    this.ttlSeconds = options.ttlSeconds ?? resolveFoldCacheTtlSeconds();
    this.updatedAtOf = options.updatedAtOf ?? readUpdatedAt;
  }

  async get(aggregateId: string, context: ProjectionStoreContext): Promise<State | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
  }

  /**
   * The state together with the ids already folded into it. A cache hit serves
   * both from the entry. On a miss the read falls through to the durable store,
   * which carries the applied-set too when it implements `getWithApplied` (so a
   * cold-cache retry can still dedup) and an empty set otherwise.
   */
  async getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: State | null;
    appliedEventIds: string[];
    /**
     * Forwarded verbatim from the durable tier. DECLARED, not incidental: every
     * ADR-066 adopter is wrapped by this store, so the executor's decision to
     * skip a pointless unwindowed re-read on an `undecodable` row reaches it
     * only through here. Left undeclared it survived purely because
     * `readDurable` happens to return the inner object unchanged, and a routine
     * refactor to `{ state, appliedEventIds }` would have silently disabled it.
     */
    miss?: "absent" | "undecodable";
  }> {
    // The executor's read-window fallback re-reads moments after its windowed
    // attempt already consulted the cache — a second Redis read is a
    // guaranteed miss that would double-count the cache and dedup metrics, so
    // the retry goes straight to the durable tier. Deliberately NO
    // dedup-unavailable accounting here: the windowed attempt already ran the
    // full miss path (including that accounting) for this same delivery —
    // counting again on the retry would double-count one logical read.
    if (context.bypassReadCache) {
      return await this.readDurable(aggregateId, context);
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
   * The durable read behind a cache miss. When the inner store persists the
   * applied-event-id set next to its row (`getWithApplied`), that set comes back
   * too, so a retry with a cold cache can still recognise a batch it committed;
   * otherwise the set is empty and dedup falls back to blind re-apply.
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
      : {
          state: await this.inner.get(aggregateId, context),
          appliedEventIds: [] as string[],
        };
    observeEsFoldCacheGetDuration(this.keyPrefix, "clickhouse", performance.now() - startedAt);
    return result;
  }

  async store(state: State, context: ProjectionStoreContext): Promise<void> {
    const aggregateId = context.key ?? context.aggregateId;
    const startedAt = performance.now();

    await this.inner.store(state, context);
    await this.cache(state, aggregateId, context);

    observeEsFoldCacheStoreDuration(this.keyPrefix, performance.now() - startedAt);
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
      // The applied-event-id set is decided upstream and stamped on the context:
      // FoldProjectionExecutor.appliedIdsForCommit unions it on a retry and
      // resets it on a fresh delivery, at all four of its commit sites, before
      // store() runs. This tier is a dumb read/write cache (ADR-066), so it
      // persists that set verbatim — it does not re-read the cache to re-merge,
      // which on the executor path was a guaranteed no-op (an extra Redis GET
      // plus a full state decode). The only other caller, replay, writes a
      // fresh row carrying no set; an absent value is treated as empty, matching
      // that path's prior result.
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
