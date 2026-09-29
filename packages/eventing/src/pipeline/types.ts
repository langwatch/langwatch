import type { SealedCommand } from "../commands/sealedCommand.ts";
import type { AggregateType } from "../domain/aggregateType.ts";
import type { Event, Projection } from "../domain/types.ts";
import type { KillSwitch } from "../kill-switch/index.ts";
import type { ProcessStore } from "../process-manager/stores/processStore.types.ts";
import type { ProjectionRegistry } from "../projections/projectionRegistry.ts";
import type { ReplayMarkerChecker } from "../projections/replayMarkerCheck.ts";
import type {
  SealedFoldProjection,
  SealedMapProjection,
  SealedStateProjection,
} from "../projections/sealedProjection.ts";
import type { EventSourcedQueueProcessor } from "../queues/index.ts";
import type { ExecutionTarget, RetentionPolicyResolver } from "../runtime.types.ts";
import type { JobRegistryEntry } from "../services/queues/queueManager.ts";
import type { EventStore, EventStoreReadContext } from "../stores/eventStore.types.ts";
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
  /** Parses a queued event with the pipeline's schema for its type (§9). */
  parseEvent: (value: unknown) => EventType;
  commandRegistrations?: readonly SealedCommand<EventType>[];
  globalRegistry?: ProjectionRegistry<Event>;
  handoffStore?: ProcessStore;
  executionTarget?: ExecutionTarget;
  replayMarkerChecker?: ReplayMarkerChecker;
  retentionPolicyResolver?: RetentionPolicyResolver;
  killSwitch?: KillSwitch;
  prepareEventForProjection?: (event: EventType) => EventType;
  warnWhenProjectionsRunInline?: boolean;
}

/** What a registered pipeline's service answers; a disabled pipeline answers it inertly. */
export interface PipelineService<EventType extends Event = Event> {
  storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void>;
  getCommandQueues(): Map<string, EventSourcedQueueProcessor<Record<string, unknown>>>;
  waitUntilReady(): Promise<void>;
  close(): Promise<void>;
}

export interface RegisteredPipeline<
  EventType extends Event = Event,
  _ProjectionTypes extends Record<string, Projection> = Record<string, Projection>,
> {
  name: string;
  aggregateType: AggregateType;
  service: PipelineService<EventType>;
  metadata: PipelineMetadata;
}

/**
 * Pipeline with command handlers attached under a `commands` property.
 */
export type PipelineWithCommandHandlers<Pipeline, Dispatchers> = Pipeline & {
  commands: Dispatchers;
};
