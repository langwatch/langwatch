import type { Event, Projection } from "../core/types";
import type { EventStream } from "../core/eventStream";

export type EventHandlerResult<
  AggregateId = string,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> = Promise<ProjectionType> | ProjectionType;

export interface EventHandler<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  /**
   * Processes a batch of events to build or update a projection.
   * Event streams are always provided in chronological order unless otherwise specified.
   */
  handle(
    stream: EventStream<AggregateId, EventType>,
  ): EventHandlerResult<AggregateId, ProjectionType>;
}
