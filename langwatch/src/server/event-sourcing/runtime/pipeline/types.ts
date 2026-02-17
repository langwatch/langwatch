import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { CommandHandlerClass } from "../../library/commands/commandHandlerClass";
import type { AggregateType } from "../../library/domain/aggregateType";
import type { Event, ParentLink, Projection } from "../../library/domain/types";
import type { FoldProjectionDefinition } from "../../library/projections/foldProjection.types";
import type { MapProjectionDefinition } from "../../library/projections/mapProjection.types";
import type { EventPublisher } from "../../library/eventPublisher.types";
import type {
  EventSourcedQueueProcessor,
  QueueProcessorFactory,
} from "../../library/queues";
import type { CommandHandlerOptions } from "../../library/services/commands/commandDispatcher";
import type { EventSourcingService } from "../../library/services/eventSourcingService";
import type { ProjectionRegistry } from "../../library/projections/projectionRegistry";
import type { EventStore } from "../../library/stores/eventStore.types";

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
  eventHandlers: Array<{
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
  eventPublisher?: EventPublisher<EventType>;
  queueProcessorFactory?: QueueProcessorFactory;
  parentLinks?: ParentLink<EventType>[];
  featureFlagService?: FeatureFlagServiceInterface;
  commandRegistrations?: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, EventType>;
    options?: CommandHandlerOptions<unknown>;
  }>;
  globalRegistry?: ProjectionRegistry<Event>;
  redisConnection?: IORedis | Cluster;
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
  parentLinks: ParentLink<EventType>[];
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
