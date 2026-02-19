import type { Event } from "../domain/types";
import type { KillSwitchOptions } from "../pipeline/types";
import type { ProjectionStoreContext } from "./projectionStoreContext";

/**
 * A stateless projection that transforms individual events into records.
 *
 * MapProjection replaces the old EventHandler interface for the common case
 * of mapping a single event to a stored record. The `map` function is pure
 * — it receives an event and returns a record (or null to skip). The
 * framework handles dispatch and persistence via the AppendStore.
 *
 * Unlike FoldProjection, MapProjection has no accumulated state — each
 * event is processed independently.
 *
 * @example
 * ```typescript
 * const spanStorage: MapProjectionDefinition<NormalizedSpan, SpanReceivedEvent> = {
 *   name: "spanStorage",
 *   eventTypes: ["lw.obs.trace.span_received"],
 *   map: (event) => normalizeSpan(event.tenantId, event.data.span, ...),
 *   store: spanAppendStore,
 * };
 * ```
 */
export interface MapProjectionDefinition<
  Record,
  E extends Event = Event,
> {
  /** Unique name for this projection within the pipeline. */
  name: string;

  /** Event types this projection reacts to. Used by the router to dispatch. */
  eventTypes: readonly string[];

  /**
   * Pure function: transforms an event into a record for storage.
   * Return null to skip storage for this event.
   */
  map(event: E): Record | null;

  /** Store for appending records. */
  store: AppendStore<Record>;

  /** Optional processing behavior configuration. */
  options?: MapProjectionOptions;
}

/**
 * Options for configuring map projection processing behavior.
 */
export interface MapProjectionOptions {
  /** Kill switch configuration. When enabled, the projection is disabled. */
  killSwitch?: KillSwitchOptions;

  /** Concurrency limit for processing jobs. */
  concurrency?: number;

  /** Whether to disable this projection. */
  disabled?: boolean;
}

/**
 * Store interface for map projections.
 * Appends individual records produced by the map function.
 */
export interface AppendStore<Record> {
  /** Appends a single record to the store. */
  append(record: Record, context: ProjectionStoreContext): Promise<void>;
}
