import type { CommandHandlerClass } from "../commands/commandHandlerClass.ts";
import type { AggregateType } from "../domain/aggregateType.ts";
import type { Event, Projection } from "../domain/types.ts";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types.ts";
import type { MapProjectionDefinition } from "../projections/mapProjection.types.ts";
import type { ProjectionRegistry } from "../projections/projectionRegistry.ts";
import type { ReplayMarkerChecker } from "../projections/replayMarkerCheck.ts";
import type { StateProjectionDefinition } from "../projections/stateProjection.types.ts";
import type { EventSourcedQueueProcessor } from "../queues/index.ts";
import type { CommandHandlerOptions } from "../services/commands/commandDispatcher.ts";
import type { EventSourcingService } from "../services/eventSourcingService.ts";
import type { JobRegistryEntry } from "../services/queues/queueManager.ts";
import type { EventStore } from "../stores/eventStore.types.ts";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types.ts";
import type { SubscriberDispatchDefinition } from "../subscribers/subscriber.types.ts";
import type { ExecutionTarget, RetentionPolicyResolver } from "../runtime.types.ts";
import type { KillSwitch } from "../kill-switch/index.ts";

/**
 * Static metadata about a pipeline for tooling and introspection.
 */
export interface PipelineMetadata {
  name: string;
  aggregateType: AggregateType;
  allowedEventTypes: readonly string[];
  projections: Array<{
    name: string;
    handlerClassName: string;
  }>;
  mapProjections: Array<{
    name: string;
    handlerClassName: string;
    eventTypes?: string[];
  }>;
  stateProjections?: Array<{
    name: string;
    handlerClassName: string;
    eventTypes?: string[];
  }>;
  commands: Array<{
    name: string;
    handlerClassName: string;
  }>;
  subscribers?: Array<{
    name: string;
    eventTypes?: string[];
  }>;
}

export interface EventSourcingPipelineDefinition<
  EventType extends Event = Event,
  _ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
> {
  name: string;
  aggregateType: AggregateType;
  allowedEventTypes: readonly string[];
  eventStore: EventStore<EventType>;
  foldProjections?: FoldProjectionDefinition<any, EventType>[];
  stateProjections?: StateProjectionDefinition<any, EventType>[];
  mapProjections?: MapProjectionDefinition<any, EventType>[];
  foldSubscribers?: Array<{
    foldName: string;
    definition: SubscriberDispatchDefinition<EventType>;
  }>;
  mapSubscribers?: Array<{
    mapName: string;
    definition: SubscriberDispatchDefinition<EventType>;
  }>;
  subscribers?: EventSubscriberDefinition<EventType>[];
  globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  globalJobRegistry?: Map<string, JobRegistryEntry>;
  commandRegistrations?: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, EventType>;
    options?: CommandHandlerOptions<unknown>;
  }>;
  globalRegistry?: ProjectionRegistry<Event>;
  executionTarget?: ExecutionTarget;
  replayMarkerChecker?: ReplayMarkerChecker;
  retentionPolicyResolver?: RetentionPolicyResolver;
  killSwitch?: KillSwitch;
  prepareEventForProjection?: (event: EventType) => EventType;
  warnWhenProjectionsRunInline?: boolean;
}

export interface RegisteredPipeline<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
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
