import type { SealedCommand } from "../commands/sealedCommand.ts";
import type { AggregateType } from "../domain/aggregateType.ts";
import type { Event, Projection } from "../domain/types.ts";
import type { KillSwitch } from "../kill-switch/index.ts";
import type { ProjectionRegistry } from "../projections/projectionRegistry.ts";
import type { ReplayMarkerChecker } from "../projections/replayMarkerCheck.ts";
import type {
  SealedFoldProjection,
  SealedMapProjection,
  SealedStateProjection,
} from "../projections/sealedProjection.ts";
import type { EventSourcedQueueProcessor } from "../queues/index.ts";
import type { ExecutionTarget, RetentionPolicyResolver } from "../runtime.types.ts";
import type { EventSourcingService } from "../services/eventSourcingService.ts";
import type { JobRegistryEntry } from "../services/queues/queueManager.ts";
import type { EventStore } from "../stores/eventStore.types.ts";
import type { EventSubscriberDefinition } from "../subscribers/eventSubscriber.types.ts";
import type { SubscriberDispatchDefinition } from "../subscribers/subscriber.types.ts";

/**
 * Static metadata about a pipeline for tooling and introspection.
 */
export interface PipelineMetadata {
  name: string;
  aggregateType: AggregateType;
  allowedEventTypes: readonly string[];
  projections: {
    name: string;
    handlerClassName: string;
  }[];
  mapProjections: {
    name: string;
    handlerClassName: string;
    eventTypes?: string[];
  }[];
  stateProjections?: {
    name: string;
    handlerClassName: string;
    eventTypes?: string[];
  }[];
  commands: {
    name: string;
    handlerClassName: string;
  }[];
  subscribers?: {
    name: string;
    eventTypes?: string[];
  }[];
}

export interface EventSourcingPipelineDefinition<
  EventType extends Event = Event,
  _ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
> {
  name: string;
  aggregateType: AggregateType;
  allowedEventTypes: readonly string[];
  eventStore: EventStore<EventType>;
  foldProjections?: SealedFoldProjection<EventType>[];
  stateProjections?: SealedStateProjection<EventType>[];
  mapProjections?: SealedMapProjection<EventType>[];
  foldSubscribers?: {
    foldName: string;
    definition: SubscriberDispatchDefinition<EventType>;
  }[];
  mapSubscribers?: {
    mapName: string;
    definition: SubscriberDispatchDefinition<EventType>;
  }[];
  subscribers?: EventSubscriberDefinition<EventType>[];
  globalQueue?: EventSourcedQueueProcessor<Record<string, unknown>>;
  globalJobRegistry?: Map<string, JobRegistryEntry>;
  commandRegistrations?: readonly SealedCommand<EventType>[];
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
