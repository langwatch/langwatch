import type { Event } from "../domain/types.ts";
import type { KillSwitchOptions } from "../kill-switch/killSwitchKeys.ts";
import type { ProjectionStoreContext } from "./projectionStoreContext.ts";

export interface ProjectionCursor {
  /** When the canonical event log accepted the event. */
  acceptedAt: number;
  /** KSUID tie-breaker for events accepted in the same millisecond. */
  eventId: string;
}

/**
 * A rebuildable operational projection row and its event cursor. These
 * timestamps describe the projected entity, not when Postgres executed the
 * write — that keeps a replay deterministic.
 */
export interface StoredProjection<State> {
  state: State;
  cursor: ProjectionCursor;
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
  version: string;
}

// ADR-146: `empty` until the first event is folded.
export type StoredProjectionRead<State> =
  | { kind: "folded"; projection: StoredProjection<State> }
  | { kind: "empty" };

/** Direct persistence boundary used by `.withPostgresProjection()`. */
export interface StateProjectionStore<State> {
  get: (key: string, context: ProjectionStoreContext) => Promise<StoredProjectionRead<State>>;

  store: (projection: StoredProjection<State>, context: ProjectionStoreContext) => Promise<void>;
}

export interface StateProjectionOptions {
  /**
   * Operator stop for this component, resolved per tenant at dispatch time.
   * Absent means the generated key; a `customKey` must also be what the
   * descriptors advertise or the switch cannot be set.
   */
  killSwitch?: KillSwitchOptions;
  /** Disable this projection in the assembled runtime. */
  disabled?: boolean;
  /** One load and one store may fold this many queued events. Defaults to 1. */
  coalesceMaxBatch?: number;
}

/**
 * The operational projection registered by `.withPostgresProjection()`.
 * Mechanically a fold, but with a narrower contract than a ClickHouse fold:
 * direct store load/apply/store, no event-log recovery, no Redis cache hook.
 */
export interface StateProjectionDefinition<State, E extends Event = Event> {
  name: string;
  version: string;
  eventTypes: readonly string[];
  init(): State;
  apply: (state: State, event: E) => State;
  store: StateProjectionStore<State>;
  key?: (event: E) => string;
  options?: StateProjectionOptions;
}
