import type { ProjectionHandler } from "./domain/handlers/projectionHandler";
import type { Event, Projection } from "./domain/types";
import type { KillSwitchOptions } from "./pipeline/types";
import type { DeduplicationStrategy } from "./queues";
import type { ProjectionStore } from "./stores/projectionStore.types";

/**
 * Configuration options for projection processing behavior.
 */
export interface ProjectionOptions<EventType extends Event = Event> {
  /**
   * Optional: Delay in milliseconds before processing the job.
   */
  delay?: number;

  /**
   * Optional: Deduplication strategy for this projection.
   *
   * - `"none"`: Explicit no deduplication - processes every event individually
   * - `"aggregate"`: Dedupe by `${tenantId}:${aggregateType}:${aggregateId}` (most common for projections)
   * - `DeduplicationConfig`: Custom deduplication configuration object
   * - `null` or `undefined`: No deduplication (default behavior)
   *
   * @default undefined (no deduplication)
   *
   * @example
   * ```typescript
   * // Use aggregate-based deduplication for projections
   * .withProjection("traceSummary", TraceSummaryProjectionHandler, {
   *   deduplication: "aggregate",
   *   delay: 1500,
   * })
   *
   * // Custom deduplication configuration
   * .withProjection("analytics", AnalyticsProjectionHandler, {
   *   deduplication: {
   *     makeId: (event) => `${event.tenantId}:custom-key`,
   *     ttlMs: 1000,
   *   },
   * })
   * ```
   */
  deduplication?: DeduplicationStrategy<EventType>;

  /**
   * Maximum batch size for processing. When set, events are accumulated
   * before processing. Only used when deduplication is enabled.
   *
   * This limits the number of events that can be accumulated during the
   * deduplication period. If more events arrive, they will still be processed
   * but may require multiple batches.
   *
   * Default: undefined (no batching limit)
   */
  maxBatchSize?: number;

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
  options?: ProjectionOptions<EventType>;
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
