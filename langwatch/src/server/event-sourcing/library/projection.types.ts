import type { ProjectionHandler } from "./domain/handlers/projectionHandler";
import type { Event, Projection } from "./domain/types";
import type { ProjectionStore } from "./stores/projectionStore.types";
import type { KillSwitchOptions } from "./pipeline/types";

/**
 * Configuration options for projection processing behavior.
 */
export interface ProjectionOptions {
  /**
   * Debounce delay in milliseconds. When set, events for the same aggregate will be
   * debounced - later events replace earlier queues events.
   *
   * Default: undefined (no debouncing)
   *
   * @example
   * ```typescript
   * // Debounce trace summary updates by 1 second
   * .withProjection("traceSummary", TraceSummaryProjectionHandler, {
   *   debounceMs: 1000,
   * })
   * ```
   */
  debounceMs?: number;

  /**
   * Maximum batch size for processing. When set, events are accumulated
   * before processing. Only used when debouncing is enabled.
   *
   * This limits the number of events that can be accumulated during the
   * debounce period. If more events arrive, they will still be processed
   * but may require multiple batches.
   *
   * Default: undefined (no batching limit)
   */
  maxBatchSize?: number;

  /**
   * Optional: Custom job ID factory for idempotency.
   * Default: event.id (ensures serial processing per event)
   */
  makeJobId?: (event: Event) => string;

  /**
   * Kill switch configuration for this projection.
   * When the feature flag is true, the projection is disabled.
   */
  killSwitch?: KillSwitchOptions;
}

/**
 * Definition of a projection that can be computed from events.
 * Each projection has a unique name, a store, and a handler.
 */
export interface ProjectionDefinition<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
> {
  /**
   * Unique name for this projection within the pipeline.
   * Used to identify which projection to rebuild or retrieve.
   */
  name: string;
  /**
   * Store for persisting this projection.
   */
  store: ProjectionStore<ProjectionType>;
  /**
   * Handler that processes events to build this projection.
   */
  handler: ProjectionHandler<EventType, ProjectionType>;
  /**
   * Optional configuration for projection processing behavior.
   */
  options?: ProjectionOptions;
}

/**
 * Type that maps projection names to their projection types.
 * Used for type-safe projection retrieval.
 */
export type ProjectionTypeMap = Record<string, Projection>;

/**
 * Map of projection names to their definitions.
 * When a ProjectionTypeMap is provided, preserves type information for each projection.
 */
export type ProjectionDefinitions<
  EventType extends Event = Event,
  ProjectionTypes extends ProjectionTypeMap = ProjectionTypeMap,
> = {
  [K in keyof ProjectionTypes]: ProjectionDefinition<
    EventType,
    ProjectionTypes[K]
  >;
};

/**
 * Extracts the projection type from a ProjectionDefinition.
 * Used for type inference in getProjectionByName methods.
 */
export type ProjectionTypeFromDefinition<T> =
  T extends ProjectionDefinition<any, infer P> ? P : never;
