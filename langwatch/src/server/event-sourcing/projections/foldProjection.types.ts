import type { Event } from "../domain/types";
import type { KillSwitchOptions } from "../pipeline/staticBuilder.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * A stateful projection that folds events into accumulated state.
 *
 * FoldProjection uses a pure functional approach: `init()` provides the
 * initial state, and `apply()` produces new state from old state + event.
 * The framework loads existing state via `store.get()`, applies the event,
 * and persists via `store.store()`.
 *
 * All projections are incremental: the event arrives in the job payload,
 * existing state is loaded (or initialized), and the single event is applied.
 *
 * State = Output: what `apply` produces is exactly what gets stored.
 *
 * @example
 * ```typescript
 * const experimentRunState: FoldProjectionDefinition<ExperimentRunStateData, ExperimentRunEvent> = {
 *   name: "experimentRunState",
 *   eventTypes: ["experiment_run.started", "experiment_run.target_result", ...],
 *   init: () => ({ runId: "", total: 0, progress: 0, ... }),
 *   apply: (state, event) => {
 *     if (isStartedEvent(event)) return { ...state, runId: event.data.runId, ... };
 *     if (isResultEvent(event)) return { ...state, progress: state.progress + 1, ... };
 *     return state;
 *   },
 *   store: experimentRunStateFoldStore,
 * };
 * ```
 */
export interface FoldProjectionDefinition<State, E extends Event = Event> {
  /** Unique name for this projection within the pipeline. */
  name: string;

  /** Schema version (YYYY-MM-DD calendar date) for this projection's stored data. */
  version: string;

  /** Event types this projection reacts to. Used by the router to dispatch. */
  eventTypes: readonly string[];

  /** Returns the initial empty state before any events are applied. */
  init(): State;

  /**
   * Pure function: produces new state from previous state and an event.
   * Must be side-effect free — all I/O happens in the store.
   */
  apply(state: State, event: E): State;

  /** Store for persisting and retrieving the fold state. */
  store: FoldProjectionStore<State>;

  /**
   * Custom key extractor. Defaults to aggregateId.
   * Useful for cross-cutting projections that group by something other than aggregateId
   * (e.g., tenantId:date for daily counts).
   */
  key?: (event: E) => string;

  /** Optional processing behavior configuration. */
  options?: FoldProjectionOptions;

  /**
   * Key name for the LastEventOccurredAt field on the state.
   * Used by the executor to detect out-of-order events.
   */
  LastEventOccurredAtKey: string;

  /**
   * Loads all events for an aggregate, sorted by occurredAt ASC.
   * Used by the executor to re-fold from scratch when out-of-order events are detected.
   *
   * Auto-wired by EventSourcingService at registration time — projections don't
   * need to provide this themselves. Optional at the type level because it's set
   * after construction, but always present at runtime.
   */
  eventLoader?: (context: {
    tenantId: string;
    aggregateId: string;
    /** occurredAt (ms) of the event that triggered the re-fold, used to
     * lower-bound the event_log rehydration scan for time-local aggregates. */
    occurredAtMs?: number;
  }) => Promise<Event[]>;

  /**
   * Loads the aggregate's events up to AND INCLUDING `upToEvent` in log order
   * (EventTimestamp, EventId), sorted by occurredAt ASC. Used by the executor
   * for `refoldOnStoreMiss` — bounding at the delivered event guarantees a
   * re-fold never pre-applies an event that is persisted but still queued for
   * this projection (per-aggregate FIFO delivers it next; applying it twice
   * would double-count).
   *
   * Auto-wired by EventSourcingService at registration time, like
   * `eventLoader`.
   */
  eventLoaderUpTo?: (context: {
    tenantId: string;
    aggregateId: string;
    upToEvent: Event;
  }) => Promise<Event[]>;

  /**
   * Cursor-paginated variant of `eventLoaderUpTo`: returns ONE page of the
   * aggregate's history up to AND INCLUDING `upToEvent`, ordered by
   * (timestamp, eventId), strictly after the `after` cursor, at most `limit`
   * events. Lets the executor stream a store-miss re-fold of a huge aggregate
   * (a hot trace can carry 100k+ events) page-by-page instead of loading the
   * whole history — and every payload — into memory at once.
   *
   * Auto-wired by EventSourcingService when the event store supports paginated
   * reads. The executor only uses it for order-insensitive folds
   * (`refoldOnOutOfOrder: false`), for which the (timestamp, eventId) page
   * order is as valid as occurredAt order.
   */
  eventLoaderUpToPaged?: (context: {
    tenantId: string;
    aggregateId: string;
    upToEvent: Event;
    after: { timestamp: number; eventId: string } | undefined;
    limit: number;
  }) => Promise<Event[]>;
}

/**
 * Options for configuring fold projection processing behavior.
 */
export interface FoldProjectionOptions {
  /** Kill switch configuration. When enabled, the projection is disabled. */
  killSwitch?: KillSwitchOptions;
  /**
   * Order used when the executor coalesces or rebuilds fold state.
   *
   * `occurredAt` (default) follows business time. `acceptedAt` follows the
   * canonical event-log cursor `(createdAt/EventTimestamp, EventId)` and is for
   * lifecycle aggregates whose accepted transition order must win even when a
   * producer submits a backdated business timestamp.
   */
  eventOrdering?: "occurredAt" | "acceptedAt";
  /**
   * Maximum number of same-aggregate events to coalesce into a single
   * load/apply/store cycle when the group is backed up. 1 (the default)
   * disables coalescing. Higher values bound how much of a backed-up group
   * is drained per dispatch — converting an O(n²) backlog into O(n).
   */
  coalesceMaxBatch?: number;
  /**
   * Bound the store's read-back to a time window around the folded event's
   * business time.
   *
   * Declared here — once, on the fold — instead of every store forwarding an
   * occurredAt hint by hand and every repository widening it with its own
   * arithmetic and its own (sometimes forgotten) unwindowed fallback. The
   * executor computes `context.readWindow = occurredAt ± widthMs` and, when a
   * windowed read misses, retries once without the window before treating the
   * aggregate as new — so a row outside the window (long-lived aggregate,
   * clock skew, backfill) is still found rather than silently overwritten by
   * a batch folded onto `init()`. Stores pass `context.readWindow` through to
   * their repository verbatim.
   *
   * Pick `widthMs` from the drift between the event's business time and the
   * backing table's partition column, not from the partition size: the window
   * is a pruning optimisation, the unwindowed retry is the correctness net.
   * Omit for stores whose backing read is not time-partitioned.
   */
  readWindow?: { widthMs: number };
  /**
   * Re-fold from the event log when `store.get()` returns null, instead of
   * starting from `init()`.
   *
   * **Defaults to `false`, and that is the shape a new fold should keep** — the
   * executor gates on `=== true`, so omitting it never re-folds. Opt in only
   * with a reason and an exit condition; this is not a free safety net.
   *
   * A re-fold scans the aggregate's whole history in `event_log` with no time
   * bound, walking cold partitions. Under ADR-066 that is the behaviour behind
   * the 2026-07-23 `TOO_MANY_PARTS` outage: as a steady-state continuity
   * mechanism it makes every cache miss pay for the entire history. A fold that
   * needs continuity earns it by persisting enough typed state to reconstruct
   * itself (a "read-back store"), NOT by re-reading the log.
   *
   * The remaining legitimate use is TRANSITIONAL, and every current adopter is
   * one: a fold that gained read-back columns has rows written before those
   * columns existed, whose defaults would decode into silently wrong state. Its
   * store compares the row's projection version and reports any older stamp as
   * a miss, so this option rebuilds exactly those rows, exactly once each,
   * before they are rewritten at the current version. It must never fire in
   * steady state, and it should be deleted once retention has aged the old rows
   * out. See `traceAnalytics`, `evaluationAnalytics` and `codingAgentSession`
   * for the pattern.
   *
   * **Check each adopter before deleting it — "transitional" is a claim about
   * the adopter, not about this option.** An adopter whose store can decline to
   * write a row (a persistability gate) or can write one the read window will
   * never find (a bad partition anchor) has a class of aggregate that misses on
   * EVERY delivery, so its `es_fold_refold_on_miss_total{outcome="performed"}`
   * never goes quiet and removing this option turns a permanent refold into
   * permanent data loss instead. `traceAnalytics` has two such classes today,
   * both documented on the projection.
   *
   * Requires `eventLoaderUpTo` (auto-wired by EventSourcingService) — the
   * executor silently declines to re-fold without it. Pair the store with a
   * RedisCachedFoldStore so a re-fold can only follow cache
   * expiry/eviction/restart rather than an ordinary event.
   *
   * @default false
   */
  refoldOnStoreMiss?: boolean;
  /**
   * Re-fold the aggregate's whole history from the event log when an event
   * arrives having occurred BEFORE the persisted checkpoint. Defaults to true.
   *
   * Set false when `apply` is order-insensitive — its accumulators commute
   * (sums, counters, min/max) and any precedence rule keys on data carried by
   * the event rather than on arrival order. Such a fold reaches the same state
   * whichever order it sees events in, so replaying the history derives nothing.
   *
   * The replay is not merely wasted there, it is actively harmful: it reads
   * EVERY event for the aggregate, and since `apply` raises the checkpoint to
   * the highest occurredAt it has seen, one replay pins the checkpoint at the
   * aggregate's maximum event time — making every later batch look out of order
   * too. A hot trace re-folded 730 times in two hours, re-reading 5.66M event
   * rows, and never caught up (2026-07-09; see
   * specs/event-sourcing/hot-trace-fold-amplification.feature).
   *
   * Turning it off never drops events: the executor applies them in occurredAt
   * order on top of the state it loaded.
   */
  refoldOnOutOfOrder?: boolean;
}

/**
 * Store interface for fold projections.
 * Handles persistence and retrieval of fold state.
 */
export interface FoldProjectionStore<State> {
  /** Persists the current fold state for an aggregate. */
  store(state: State, context: ProjectionStoreContext): Promise<void>;

  /** Optional batch store for persisting multiple fold states at once. */
  storeBatch?(
    entries: Array<{ state: State; context: ProjectionStoreContext }>,
  ): Promise<void>;

  /** Retrieves the stored state for an aggregate, or null if not found. */
  get(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<State | null>;

  /**
   * Retrieves the stored state together with the ids of the events already
   * folded into it.
   *
   * Implemented by stores that persist the applied-event-id set durably next to
   * the state row (first adopter: the codingAgentSession ClickHouse store) — and
   * by the Redis cache wrapper, which serves the set from its entry. The
   * executor prefers it over `get()` so redelivery dedup survives cache loss: a
   * retry that reaches a cold cache can still read the durable set and recognise
   * a batch it already committed. Stores that keep no such set omit it; the
   * executor then reads `get()` and treats the applied set as empty.
   */
  getWithApplied?(
    aggregateId: string,
    context: ProjectionStoreContext,
  ): Promise<{
    state: State | null;
    appliedEventIds: string[];
    /**
     * Why `state` is null, for stores that can tell them apart.
     *
     * `absent` — no row for this aggregate in the scope that was read.
     * `undecodable` — a row IS there and the store refused it, which for an
     * ADR-066 adopter means its version gate rejected an older shape.
     *
     * The distinction is load-bearing on both sides. The executor answers a
     * windowed miss by re-reading UNWINDOWED, which is right for `absent` (the
     * row may sit outside the window) and pure waste for `undecodable` (the row
     * was found and refused; a wider scope finds the same row and refuses it
     * again) — and that wasted read is deliberately unpruned. It also keeps the
     * read-window metric honest: counting a version rejection as `absent` reads
     * as "the window missed a live aggregate", which is a different operator
     * action than "these rows need rebuilding".
     *
     * Omit when the store cannot distinguish; the executor then assumes
     * `absent`, which is the safe direction.
     */
    miss?: "absent" | "undecodable";
  }>;
}
