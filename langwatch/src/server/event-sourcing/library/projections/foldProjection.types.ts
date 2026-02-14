import type { Event } from "../domain/types";
import type { KillSwitchOptions } from "../pipeline/types";
import type { DeduplicationStrategy } from "../queues";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * A stateful projection that folds events into accumulated state.
 *
 * FoldProjection replaces the old ProjectionHandler interface with a pure
 * functional approach: `init()` provides the initial state, and `apply()`
 * produces new state from old state + event. The framework handles the
 * rebuild loop and persistence.
 *
 * State = Output: what `apply` produces is exactly what gets stored.
 * If a projection needs internal bookkeeping (e.g., intermediate normalized
 * spans), include it in the state type — the store can choose to omit
 * fields that are not needed for querying.
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
export interface FoldProjectionDefinition<
  State,
  E extends Event = Event,
> {
  /** Unique name for this projection within the pipeline. */
  name: string;

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

  /** Execution strategy. Default: "rebuild" (replays all events). */
  strategy?: "rebuild" | "incremental";

  /** Optional processing behavior configuration. */
  options?: FoldProjectionOptions<E>;
}

/**
 * Options for configuring fold projection processing behavior.
 */
export interface FoldProjectionOptions<E extends Event = Event> {
  /** Delay in milliseconds before processing the job. */
  delay?: number;

  /** Deduplication strategy for this projection. */
  deduplication?: DeduplicationStrategy<E>;

  /** Kill switch configuration. When enabled, the projection is disabled. */
  killSwitch?: KillSwitchOptions;
}

/**
 * Store interface for fold projections.
 * Handles persistence and retrieval of fold state.
 */
export interface FoldProjectionStore<State> {
  /** Persists the current fold state for an aggregate. */
  store(state: State, context: ProjectionStoreContext): Promise<void>;

  /** Retrieves the stored state for an aggregate, or null if not found. */
  get(aggregateId: string, context: ProjectionStoreContext): Promise<State | null>;
}
