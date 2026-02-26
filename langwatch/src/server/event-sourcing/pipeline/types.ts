import type { FeatureFlagServiceInterface } from "../../featureFlag/types";
import type { CommandHandlerClass } from "../commands/commandHandlerClass";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, Projection } from "../domain/types";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../projections/mapProjection.types";
import type { ProjectionRegistry } from "../projections/projectionRegistry";
import type { EventSourcedQueueProcessor } from "../queues";
import type { ReactorDefinition } from "../reactors/reactor.types";
import type { CommandHandlerOptions } from "../services/commands/commandDispatcher";
import type { EventSourcingService } from "../services/eventSourcingService";
import type { JobRegistryEntry } from "../services/queues/queueManager";
import type { EventStore } from "../stores/eventStore.types";

/**
 * Static metadata about a pipeline for tooling and introspection.
 */
export interface PipelineMetadata {
  name: string;
  aggregateType: AggregateType;
  projections: Array<{
    name: string;
    handlerClassName: string;
  }>;
  mapProjections: Array<{
    name: string;
    handlerClassName: string;
    eventTypes?: string[];
  }>;
  commands: Array<{
    name: string;
    handlerClassName: string;
  }>;
}

export interface EventSourcingPipelineDefinition<
  EventType extends Event = Event,
  _ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
> {
  name: string;
  aggregateType: AggregateType;
  eventStore: EventStore<EventType>;
  foldProjections?: FoldProjectionDefinition<any, EventType>[];
  mapProjections?: MapProjectionDefinition<any, EventType>[];
  reactors?: Array<{ foldName: string; definition: ReactorDefinition<EventType> }>;
  globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  globalJobRegistry?: Map<string, JobRegistryEntry>;
  featureFlagService?: FeatureFlagServiceInterface;
  commandRegistrations?: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, EventType>;
    options?: CommandHandlerOptions<unknown>;
  }>;
  globalRegistry?: ProjectionRegistry<Event>;
  processRole?: "web" | "worker";
}

export interface RegisteredPipeline<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<
    string,
    Projection
  >,
> {
  name: string;
  aggregateType: AggregateType;
  service: EventSourcingService<EventType, ProjectionTypes>;
  metadata: PipelineMetadata;
}

/**
 * Pipeline with command handlers attached under a `commands` property.
 */
export type PipelineWithCommandHandlers<
  Pipeline extends RegisteredPipeline<any, any>,
  Dispatchers extends Record<string, EventSourcedQueueProcessor<any>>,
> = Pipeline & {
  commands: Dispatchers;
};
