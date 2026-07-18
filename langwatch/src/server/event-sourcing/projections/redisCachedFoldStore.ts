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
import { PendingConfirmations } from "./foldCache/pendingConfirmations";
import type { ProjectionStoreContext } from "./projectionStoreContext";

const logger = createLogger("langwatch:event-sourcing:redis-cached-fold-store");

export interface RedisCachedFoldStoreOptions<State = unknown> {
  keyPrefix: string;
  /**
   * Reads the state's own version. Defaults to the `UpdatedAt` field, which
   * `AbstractFoldProjection` maintains as strictly increasing per apply
   * (`Math.max(Date.now(), prev + 1)`) — the property the confirmation check
   * relies on. Projections keyed on a different field supply their own reader.
   */
  updatedAtOf?: (state: State) => number;
  backstopTtlSeconds?: number;
  checkDelayMs?: number;
}

/**
 * How long an unconfirmed entry may survive.
 *
 * This is a leak guard, not a residency knob. Under normal operation the
 * confirmation processor releases entries within seconds of an aggregate going
 * quiet, so this only fires when confirmation itself is broken — the processor
 * is down, or the durable store never caught up. It is generous on purpose:
 * expiring early reintroduces exactly the unverified-read hole the design
 * exists to close, and an entry that lingers costs only memory.
 */
function defaultBackstopTtlSeconds(): number {
  const raw = process.env.LANGWATCH_FOLD_CACHE_BACKSTOP_TTL_SECONDS;
  const fallback = 24 * 60 * 60;
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * How long after a write to first check whether the durable store has caught up.
 *
 * Sized to clear the async-insert flush window comfortably so the first check
 * usually succeeds and no re-check is needed. Checking sooner does not release
 * the entry any earlier — it just spends a query to be told "not yet".
 */
function defaultCheckDelayMs(): number {
  const raw = process.env.LANGWATCH_FOLD_CACHE_CHECK_DELAY_MS;
  const fallback = 5_000;
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function readUpdatedAt<State>(state: State): number {
  const value = (state as { UpdatedAt?: unknown })?.UpdatedAt;
  return typeof value === "number" ? value : Date.now();
}

/**
 * Caches fold state in Redis in front of a durable store, and releases the
 * cached copy only once the durable store is confirmed to hold it.
 *
 * The durable store is replicated and written without waiting for replication,
 * so a read can land on a replica that has not caught up and return state
 * missing recent events. Folding onto that loses them silently. Time-based
 * expiry cannot prevent this because it knows nothing about whether the
 * durable write has landed — which is why eviction here is driven by
 * confirmation instead of by a clock.
 *
 * The property that makes the rest of the system simple: **a cache miss means
 * the durable store is authoritative**, because confirmation is the only thing
 * that removes an entry. So reading through on a miss is correct, with no
 * quorum write, no sequential-consistency read, and no rebuild from the event
 * log on the steady-state path.
 *
 * The backstop TTL is the sole exception and is reported separately, so a miss
 * caused by it is never mistaken for a confirmed one.
 */
export class RedisCachedFoldStore<State>
  implements FoldProjectionStore<State>
{
  private readonly keyPrefix: string;
  private readonly backstopTtlSeconds: number;
  private readonly checkDelayMs: number;
  private readonly updatedAtOf: (state: State) => number;
  private readonly pending: PendingConfirmations;

  constructor(
    private readonly inner: FoldProjectionStore<State>,
    private readonly redis: Redis,
    options: RedisCachedFoldStoreOptions<State>,
  ) {
    this.keyPrefix = options.keyPrefix;
    this.backstopTtlSeconds =
      options.backstopTtlSeconds ?? defaultBackstopTtlSeconds();
    this.checkDelayMs = options.checkDelayMs ?? defaultCheckDelayMs();
    this.updatedAtOf = options.updatedAtOf ?? readUpdatedAt;
    this.pending = new PendingConfirmations(redis, options.keyPrefix);
  }

  async get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<State | null> {
    return (await this.getWithApplied(aggregateId, context)).state;
  }

  /**
   * The state together with the events already folded into it.
   *
   * The executor uses the applied-set to recognise a redelivery: the queue is
   * at-least-once, so a job that fails after its state was stored is
   * re-dispatched with the same events, and most fold handlers accumulate
   * (counters, sums, appends) rather than being idempotent.
   *
   * On a miss the set is empty, and correctly so — confirmation is the only
   * thing that removes an entry, so a miss means the durable store already
   * holds everything and there is nothing left to deduplicate against.
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
   * Writes the entry and schedules its confirmation.
   *
   * A failure here is logged but not thrown. Losing the cache entry is not a
   * correctness problem on its own — the next read falls through to the durable
   * store, which is where the state already is, since the durable write
   * completed above. What it costs is the read-your-writes window, so it is
   * counted rather than swallowed silently.
   */
  private async cache(
    state: State,
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const key = this.redisKey(aggregateId, context);
    const updatedAt = this.updatedAtOf(state);

    try {
      const previous = await this.readCachedAppliedIds(key);
      const payload = encodeFoldCacheEntry({
        state,
        updatedAt,
        appliedEventIds: mergeAppliedEventIds({
          previous,
          applied: context.appliedEventIds ?? [],
        }),
      });

      observeEsFoldCacheEntryBytes(this.keyPrefix, Buffer.byteLength(payload));

      await this.redis.set(key, payload, "EX", this.backstopTtlSeconds);

      await this.pending.register({
        tenantId: String(context.tenantId),
        aggregateId,
        dueAtMs: Date.now() + this.checkDelayMs,
      });
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
