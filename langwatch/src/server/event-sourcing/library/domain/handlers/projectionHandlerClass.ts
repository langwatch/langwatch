import type { ProjectionStore } from "../../stores/projectionStore.types";
import type { Event, Projection } from "../types";
import type { ProjectionHandler } from "./projectionHandler";

/**
 * Static properties and methods that must be defined on a ProjectionHandlerClass.
 * These are accessed via the constructor (class) rather than instances.
 */
export interface ProjectionHandlerClassStatic<
  EventType extends Event,
  ProjectionType extends Projection,
> {
  /**
   * Projection store for persisting this projection.
   * Required static property.
   */
  readonly store: ProjectionStore<ProjectionType>;
}

/**
 * Self-contained projection handler class that bundles handler implementation and store.
 *
 * This design allows pipeline registration by simply passing the class, eliminating the need
 * to separately configure handler and store. The framework extracts all necessary information
 * from static properties.
 *
 * @example
 * ```typescript
 * class MyProjectionHandler implements ProjectionHandler<MyEvent, MyProjection> {
 *   static readonly store = myProjectionStore;
 *
 *   handle(stream: EventStream<...>): MyProjection {
 *     // Build projection from events
 *   }
 * }
 * ```
 */
export type ProjectionHandlerClass<
  EventType extends Event,
  ProjectionType extends Projection,
> = ProjectionHandlerClassStatic<EventType, ProjectionType> &
  (new () => ProjectionHandler<EventType, ProjectionType>);

/**
 * Type helper to extract the event type from a ProjectionHandlerClass.
 */
export type ExtractProjectionHandlerEvent<T> =
  T extends ProjectionHandlerClass<infer EventType, any> ? EventType : never;

/**
 * Type helper to extract the projection type from a ProjectionHandlerClass.
 */
export type ExtractProjectionHandlerProjection<T> =
  T extends ProjectionHandlerClass<any, infer ProjectionType>
    ? ProjectionType
    : never;
