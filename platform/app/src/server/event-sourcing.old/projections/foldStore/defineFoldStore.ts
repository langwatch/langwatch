import type { RetentionCategory } from "~/server/data-retention/retentionPolicy.schema";
import { retentionDaysFrom } from "../../pipelines/shared/analyticsStoreBase";
import { CachedFoldStore } from "../cachedFoldStore";
import type { FoldCacheClient } from "../foldCache/foldCacheClient";
import type { FoldProjectionStore } from "../foldProjection.types";
import type { ProjectionStoreContext } from "../projectionStoreContext";
import type { FoldCodec, VersionedRow } from "./foldCodec";

/**
 * The read a fold store issues against its table: one aggregate's last
 * committed row plus the ids already folded into it.
 *
 * BUILT BY THE LIBRARY, not by the store. A store binds only its repository's
 * own method name and id parameter; the tenant scope and the window are on the
 * query before any per-store code runs. That is deliberate: `RepositoryFoldStore`
 * drops `context.readWindow` on the floor, so the window its adopters declare is
 * silently inert, and a declared-but-uncarried window is worse than no window —
 * the fold claims a pruned read, the metrics agree, and the query scans every
 * partition.
 *
 * `window` is passed through VERBATIM. A store never widens it and never
 * implements a fallback — on a windowed miss for a row that is merely absent the
 * executor retries unwindowed, and on a row that was found and refused it does
 * not, because a wider scope only finds the same row again.
 *
 * WHERE the window clause lands in the SQL is the repository's business, not
 * this library's: it depends on whether the table's partition column is frozen
 * or advances with the aggregate, which is a fact about the table. This library
 * deliberately holds NO table facts — no partition column, no engine key, no
 * tenant column — so the shared ClickHouse schema catalogue has exactly one
 * consumer to grow into and this is not a second, drifting copy of it.
 */
export interface FoldRowQuery {
  readonly tenantId: string;
  readonly aggregateId: string;
  readonly window?: { fromMs: number; toMs: number };
}

export interface FoundFoldRow<Row> {
  readonly row: Row;
  readonly appliedEventIds: string[];
}

/**
 * The write half of a fold store's table port. Both of today's read-back
 * repositories already have exactly this shape, so the `upsertBatch ??
 * Promise.all(upsert)` fallback every store hand-rolled lives here once.
 */
export interface FoldRowRepository<Row> {
  upsert(
    row: Row,
    retentionDays?: number,
    appliedEventIds?: readonly string[],
  ): Promise<void>;
  upsertBatch?(
    entries: Array<{
      row: Row;
      retentionDays?: number;
      appliedEventIds?: readonly string[];
    }>,
  ): Promise<void>;
}

export interface FoldStoreInput<
  State,
  Row extends VersionedRow,
  Repository extends FoldRowRepository<Row>,
> {
  /**
   * Names the store: the cache key prefix, the telemetry label, and the name
   * the generation ratchet reports against. One name, so a fold cannot be
   * called one thing in its cache and another in its metrics.
   */
  readonly name: string;

  /**
   * The kind of data the table holds. The customer's retention for that
   * category is stamped on every row this store writes — a category, not a day
   * count, so stamping cannot be forgotten and cannot be got wrong per write.
   */
  readonly retention: RetentionCategory;

  /**
   * Whether a state is worth committing yet. Omit for a fold where every state
   * is (the usual case); declare it where an early, half-formed state would
   * churn the table for an aggregate that may never amount to anything.
   */
  readonly signal?: (state: State) => boolean;

  /** Binds the aggregate read to this repository's own method name. */
  readonly read: (
    repository: Repository,
    query: FoldRowQuery,
  ) => Promise<FoundFoldRow<Row> | null>;

  /** The round-trip: the only genuinely per-aggregate logic there is. */
  readonly codec: FoldCodec<State, Row>;
}

/**
 * A fold store definition: the round-trip pair, the table it lives in, and the
 * kind of data it holds. Everything else — retention stamping, the read-back
 * gate, arming the rebuild that gate needs, reporting a refused row as
 * distinct from an absent one, the batch/single write duality, copying the
 * applied-event watermark, and the cache tier in front of it — is a consequence
 * the platform supplies, identically, for every fold (ADR-099).
 *
 * Two ways to obtain a live store:
 *
 * - {@link FoldStoreDefinition.cached} — the one to use. The cache tier is part
 *   of the storage design, not an opt-in, so this is the shape that exists.
 * - {@link FoldStoreDefinition.Store} — the durable tier alone, for the
 *   composition sites that still assemble the cache by hand and for tests that
 *   exercise the table read directly.
 */
export interface FoldStoreDefinition<
  State,
  Row extends VersionedRow,
  Repository extends FoldRowRepository<Row>,
> {
  readonly name: string;
  readonly retention: RetentionCategory;
  readonly codec: FoldCodec<State, Row>;

  /** The durable tier, bound to a repository. */
  readonly Store: new (
    repository: Repository,
  ) => BoundFoldStore<State>;

  /** The store as it is meant to be used: already cached. */
  cached(deps: {
    repository: Repository;
    cache: FoldCacheClient;
  }): CachedFoldStore<State>;
}

/**
 * What a store built here actually is.
 *
 * `FoldProjectionStore` leaves `storeBatch`, `getWithApplied`,
 * `projectionVersion` and `refoldsOnMiss` optional, because a hand-rolled store
 * may implement none of them. A store built from a round-trip declaration
 * implements all four, always — so saying so here is what lets a caller (and a
 * test) reach them without a non-null assertion, and what makes "this fold
 * forgot its batch path" unrepresentable rather than merely unlikely.
 */
export interface BoundFoldStore<State> extends FoldProjectionStore<State> {
  readonly projectionVersion: string;
  readonly refoldsOnMiss: true;
  storeBatch(
    entries: Array<{ state: State; context: ProjectionStoreContext }>,
  ): Promise<void>;
  getWithApplied(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: State | null;
    appliedEventIds: string[];
    miss?: "absent" | "undecodable";
  }>;
}

/**
 * The answer to a read that found no state. Not two kinds of return value: one
 * kind, carrying why, because the executor's decision to skip a pointless
 * unwindowed re-read depends on the difference and no store should have to
 * remember to say it.
 */
function noState(reason: "absent" | "undecodable"): {
  state: null;
  appliedEventIds: string[];
  miss: "absent" | "undecodable";
} {
  // The watermark goes with the state. Keeping it would make the executor skip
  // the very events a rebuild needs to replay.
  return { state: null, appliedEventIds: [], miss: reason };
}

export function defineFoldStore<
  State,
  Row extends VersionedRow,
  Repository extends FoldRowRepository<Row>,
>(
  input: FoldStoreInput<State, Row, Repository>,
): FoldStoreDefinition<State, Row, Repository> {
  const { name, retention, signal, read, codec } = input;

  class RoundTripFoldStore implements BoundFoldStore<State> {
    /**
     * Keys the fold cache, so a shape change misses rather than serving state
     * in the old shape past the gate below.
     */
    readonly projectionVersion = codec.writes;

    /**
     * A store that decides which shapes it can read must be able to rebuild the
     * ones it refuses, or refusing one silently replaces a complete state with
     * a partial one. DECLARED here rather than on the fold, so the gate and the
     * rebuild cannot be separated by an edit to a different file.
     */
    readonly refoldsOnMiss = true;

    constructor(private readonly repository: Repository) {}

    async store(state: State, context: ProjectionStoreContext): Promise<void> {
      const entry = this.toEntry(state, context);
      if (!entry) return;
      await this.repository.upsert(
        entry.row,
        entry.retentionDays,
        entry.appliedEventIds,
      );
    }

    async storeBatch(
      entries: Array<{ state: State; context: ProjectionStoreContext }>,
    ): Promise<void> {
      const rows = entries
        .map(({ state, context }) => this.toEntry(state, context))
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
      if (rows.length === 0) return;

      if (this.repository.upsertBatch) {
        await this.repository.upsertBatch(rows);
        return;
      }
      await Promise.all(
        rows.map(({ row, retentionDays, appliedEventIds }) =>
          this.repository.upsert(row, retentionDays, appliedEventIds),
        ),
      );
    }

    async getWithApplied(
      aggregateId: string,
      context: ProjectionStoreContext,
    ): Promise<{
      state: State | null;
      appliedEventIds: string[];
      miss?: "absent" | "undecodable";
    }> {
      const found = await read(this.repository, {
        tenantId: String(context.tenantId),
        aggregateId,
        window: context.readWindow,
      });
      if (!found) return noState("absent");
      // One comparison. A row below the decoder's floor — an older shape, a
      // withdrawn one, or a stamp whose evidence the row does not carry — is
      // reported as FOUND AND REFUSED, which is what arms the rebuild and what
      // stops the executor spending an unpruned re-read on it.
      if (!codec.readable(found.row)) return noState("undecodable");
      return {
        state: codec.decode(found.row),
        appliedEventIds: found.appliedEventIds,
      };
    }

    /** State only; delegates so the two read paths cannot diverge. */
    async get(
      aggregateId: string,
      context: ProjectionStoreContext,
    ): Promise<State | null> {
      return (await this.getWithApplied(aggregateId, context)).state;
    }

    private toEntry(
      state: State,
      context: ProjectionStoreContext,
    ): {
      row: Row;
      retentionDays: number;
      appliedEventIds: string[];
    } | null {
      if (signal && !signal(state)) return null;
      return {
        row: codec.project(state, {
          tenantId: String(context.tenantId),
          aggregateId: String(context.aggregateId),
          version: codec.writes,
        }),
        retentionDays: retentionDaysFrom(context, retention),
        // The executor's redelivery-dedup watermark, persisted next to the row
        // so a retry with a cold cache still recognises a batch it committed.
        appliedEventIds: context.appliedEventIds
          ? [...context.appliedEventIds]
          : [],
      };
    }
  }

  return {
    name,
    retention,
    codec,
    Store: RoundTripFoldStore,
    cached: ({ repository, cache }) =>
      new CachedFoldStore<State>(new RoundTripFoldStore(repository), cache, {
        keyPrefix: name,
      }),
  };
}
