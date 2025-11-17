import type { Event, Projection } from "../core/types";
import type { EventStore } from "../stores/eventStore";
import type { ProjectionStore } from "../stores/projectionStore.types";
import type { EventHandler } from "../processing/eventHandler";
import type {
  EventSourcingOptions,
  EventSourcingServiceOptions,
} from "./eventSourcingService";
import { EventSourcingService } from "./eventSourcingService";

export interface EventSourcingPipelineOptions<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  eventStore: EventStore<AggregateId, EventType>;
  projectionStore: ProjectionStore<AggregateId, ProjectionType>;
  eventHandler: EventHandler<AggregateId, EventType, ProjectionType>;
  serviceOptions?: EventSourcingOptions<AggregateId, EventType>;
}

export function createEventSourcingPipeline<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
>(
  options: EventSourcingPipelineOptions<AggregateId, EventType, ProjectionType>,
): EventSourcingService<AggregateId, EventType, ProjectionType> {
  const serviceOptions: EventSourcingServiceOptions<
    AggregateId,
    EventType,
    ProjectionType
  > = {
    eventStore: options.eventStore,
    projectionStore: options.projectionStore,
    eventHandler: options.eventHandler,
    serviceOptions: options.serviceOptions,
  };

  return new EventSourcingService(serviceOptions);
}
