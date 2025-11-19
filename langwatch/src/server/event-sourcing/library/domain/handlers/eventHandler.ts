import type { Event, Projection } from "../types";
import type { EventStream } from "../../streams/eventStream";

/**
 * Result type for event handler execution.
 * Handlers can return a projection directly or as a promise.
 */
export type EventHandlerResult<ProjectionType extends Projection = Projection> =
  Promise<ProjectionType> | ProjectionType;

/**
 * Handler that processes a stream of events to build or update a projection.
 *
 * Event handlers are the core of the event sourcing system - they transform event streams
 * into queryable projections. The framework provides events in chronological order (unless
 * a custom ordering strategy is specified).
 */
export interface EventHandler<
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
  ): EventHandlerResult<ProjectionType>;
}
