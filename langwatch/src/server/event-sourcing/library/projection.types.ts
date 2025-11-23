/**
 * Types for managing multiple projections per aggregate.
 */

import type { Event, Projection } from "./domain/types";
import type { ProjectionHandler } from "./domain/handlers/projectionHandler";
import type { ProjectionStore } from "./stores/projectionStore.types";

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
}

/**
 * Map of projection names to their definitions.
 */
export type ProjectionDefinitions<EventType extends Event = Event> = Record<
  string,
  ProjectionDefinition<EventType, any>
>;
