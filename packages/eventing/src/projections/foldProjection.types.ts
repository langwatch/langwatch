import type { Event } from "../domain/types.ts";
import type { KillSwitchOptions } from "../kill-switch/killSwitchKeys.ts";
import type { ProjectionStoreContext } from "./projectionStoreContext.ts";

// Stateful projection folding events into accumulated state via pure functions:
// `init()` for initial state, `apply()` for state + event → new state.
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
  apply: (state: State, event: E) => State;

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
   * Loads all events for an aggregate, sorted by occurredAt ASC, to re-fold
   * from scratch on out-of-order events. Auto-wired by EventSourcingService;
   * optional at the type level only because it's set after construction.
   */
  eventLoader?: (context: {
    tenantId: string;
    aggregateId: string;
    /** occurredAt (ms) of the event that triggered the re-fold, used to
     * lower-bound the event_log rehydration scan for time-local aggregates. */
    occurredAtMs?: number;
  }) => Promise<Event[]>;

  // Loads aggregate's events up to and including upToEvent; bounding prevents
  // re-folds from pre-applying persisted but still-queued events.
  eventLoaderUpTo?: (context: {
    tenantId: string;
    aggregateId: string;
    upToEvent: Event;
  }) => Promise<Event[]>;

  // Paginated variant of eventLoaderUpTo for streaming store-miss re-folds of
  // huge aggregates; auto-wired when event store supports paginated reads.
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
  // Operator stop resolved per tenant; absent means generated key.
  // Custom key must match descriptors or switch cannot be set.
  killSwitch?: KillSwitchOptions;
  /** Disable this projection in the assembled runtime. */
  disabled?: boolean;
  // `occurredAt` (default) follows business time; `acceptedAt` follows
  // event-log cursor for lifecycle aggregates where accepted order must win.
  eventOrdering?: "occurredAt" | "acceptedAt";
  // Max same-aggregate events to coalesce per cycle (default 500); set 1
  // to opt out; converts O(n²) backlog into O(n).
  coalesceMaxBatch?: number;
  // Bound store read-back to a time window around folded event's business
  // time; unwindowed retry is the correctness net. Omit for non-partitioned reads.
  readWindow?: { widthMs: number };
  // Re-fold from event log on store miss; transitional only for rows predating
  // read-back columns. See ADR-066; requires eventLoaderUpTo and RedisCachedFoldStore.
  refoldOnStoreMiss?: boolean;
  // Treat ABSENT store read as authoritative (fold from init without fallback);
  // requires store never declines write and readWindow covers every live row.
  trustAbsentMiss?: boolean;
  // Re-fold aggregate history for out-of-order events; set false when apply
  // is order-insensitive (sum, counter) and commutes on event data not arrival order.
  refoldOnOutOfOrder?: boolean;
}

// ADR-146: `empty` until the first event is folded.
export type FoldStateRead<State> = { kind: "folded"; state: State } | { kind: "empty" };

/**
 * Store interface for fold projections.
 * Handles persistence and retrieval of fold state.
 */
export interface FoldProjectionStore<State> {
  /** Persists the current fold state for an aggregate. */
  store: (state: State, context: ProjectionStoreContext) => Promise<void>;

  /** Optional batch store for persisting multiple fold states at once. */
  storeBatch?: (entries: { state: State; context: ProjectionStoreContext }[]) => Promise<void>;

  /** The folded state for an aggregate, or `empty` when nothing has been folded yet. */
  get: (aggregateId: string, context: ProjectionStoreContext) => Promise<FoldStateRead<State>>;

  // Retrieves state with ids of already-folded events for redelivery dedup.
  // Executor prefers this over get() so dedup survives cache loss.
  getWithApplied?: (
    aggregateId: string,
    context: ProjectionStoreContext,
  ) => Promise<{
    state: State | null;
    appliedEventIds: string[];
    // Why state is null: `absent` = no row, `undecodable` = row refused (version
    // gate). Distinction is load-bearing; executor re-reads unwindowed for absent only.
    miss?: "absent" | "undecodable";
  }>;
}
