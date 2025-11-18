import type { Event, Projection } from "./core/types";
import type { AggregateType } from "./core/aggregateType";
import type { EventStore } from "./stores/eventStore.types";
import type { ProjectionStore } from "./stores/projectionStore.types";
import type { EventHandler } from "./processing/eventHandler";
import type { EventSourcingService } from "./services/eventSourcingService";

export interface EventSourcingPipelineDefinition<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  /**
   * Logical name for this pipeline, used for logging/metrics.
   */
  name: string;
  /**
   * Aggregate type for this pipeline (e.g., "trace", "user").
   */
  aggregateType: AggregateType;
  eventStore: EventStore<AggregateId, EventType>;
  projectionStore: ProjectionStore<AggregateId, ProjectionType>;
  eventHandler: EventHandler<AggregateId, EventType, ProjectionType>;
}

export interface RegisteredPipeline<
  AggregateId = string,
  EventType extends Event<AggregateId> = Event<AggregateId>,
  ProjectionType extends Projection<AggregateId> = Projection<AggregateId>,
> {
  name: string;
  aggregateType: AggregateType;
  service: EventSourcingService<AggregateId, EventType, ProjectionType>;
}

