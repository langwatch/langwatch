import type { Event } from "../domain/types";
import type { KillSwitchOptions } from "../pipeline/staticBuilder.types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

export interface ProjectionCursor {
  /** When the canonical event log accepted the event. */
  acceptedAt: number;
  /** KSUID tie-breaker for events accepted in the same millisecond. */
  eventId: string;
}

/**
 * A rebuildable operational projection row and its event cursor.
 *
 * These timestamps describe the projected entity, not when Postgres happened
 * to execute the write. That keeps a replay deterministic.
 */
export interface StoredProjection<State> {
  state: State;
  cursor: ProjectionCursor;
  occurredAt: number;
  createdAt: number;
  updatedAt: number;
  version: string;
}

/** Direct persistence boundary used by `.withProjection()`. */
export interface StateProjectionStore<State> {
  load(
    key: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjection<State> | null>;

  store(
    projection: StoredProjection<State>,
    context: ProjectionStoreContext,
  ): Promise<void>;
}

export interface StateProjectionOptions {
  killSwitch?: KillSwitchOptions;
  /** One load and one store may fold this many queued events. Defaults to 1. */
  coalesceMaxBatch?: number;
}

/**
 * The default operational projection registered by `.withProjection()`.
 *
 * It is mechanically a fold, but deliberately has a narrower contract than a
 * ClickHouse fold: direct store load/apply/store, no event-log recovery read,
 * no Redis cache hook, and no projection-attached reactor or outbox.
 */
export interface StateProjectionDefinition<
  State,
  E extends Event = Event,
> {
  name: string;
  version: string;
  eventTypes: readonly string[];
  init(): State;
  apply(state: State, event: E): State;
  store: StateProjectionStore<State>;
  key?: (event: E) => string;
  options?: StateProjectionOptions;
}

/** Reuse an existing type-aware fold reducer with a direct operational store. */
export function createStateProjection<State, E extends Event>({
  name,
  reducer,
  store,
  options,
}: {
  name: string;
  reducer: Pick<
    StateProjectionDefinition<State, E>,
    "version" | "eventTypes" | "init" | "apply" | "key"
  >;
  store: StateProjectionStore<State>;
  options?: StateProjectionOptions;
}): StateProjectionDefinition<State, E> {
  return {
    name,
    version: reducer.version,
    eventTypes: reducer.eventTypes,
    init: () => reducer.init(),
    apply: (state, event) => reducer.apply(state, event),
    store,
    ...(reducer.key ? { key: reducer.key } : {}),
    ...(options ? { options } : {}),
  };
}
