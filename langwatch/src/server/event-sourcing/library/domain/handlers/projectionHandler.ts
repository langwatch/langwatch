import type { EventStream } from "../../streams/eventStream";
import type { Event, Projection } from "../types";

/**
 * Result type for projection handler execution.
 * Handlers can return a projection directly or as a promise.
 * Returning null indicates the handler cannot produce a projection yet
 * (e.g., waiting for more events) - the events are stored but no projection is written.
 */
export type ProjectionHandlerResult<
  ProjectionType extends Projection = Projection,
> = Promise<ProjectionType | null> | ProjectionType | null;

/**
 * Handler that processes a stream of events to build or update a projection.
 *
 * Projection handlers are the core of the event sourcing system - they transform event streams
 * into queryable projections. The framework provides events in chronological order (unless
 * a custom ordering strategy is specified).
 */
export interface ProjectionHandler<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
> {
  /**
   * Processes a batch of events to build or update a projection.
   *
   * Event streams are always provided in chronological order unless otherwise specified
   * via the ordering strategy in EventSourcingOptions.
   *
   * @param stream - The event stream to process
   * @returns The projection (or promise of projection) built from the events
   */
  handle(
    stream: EventStream<EventType["tenantId"], EventType>,
  ): ProjectionHandlerResult<ProjectionType>;
}
