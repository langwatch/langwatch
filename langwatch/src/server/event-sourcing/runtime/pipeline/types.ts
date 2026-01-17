import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { AggregateType } from "../../library/domain/aggregateType";
import type { Event, ParentLink, Projection } from "../../library/domain/types";
import type { EventHandlerDefinitions } from "../../library/eventHandler.types";
import type {
  ProjectionDefinitions,
  ProjectionTypeMap,
} from "../../library/projection.types";
import type { EventPublisher } from "../../library/publishing/eventPublisher.types";
import type {
  EventSourcedQueueDefinition,
  EventSourcedQueueProcessor,
} from "../../library/queues";
import type { EventSourcingService } from "../../library/services/eventSourcingService";
import type { ProcessorCheckpointStore } from "../../library/stores/eventHandlerCheckpointStore.types";
import type { EventStore } from "../../library/stores/eventStore.types";
import type { DistributedLock } from "../../library/utils/distributedLock";

/**
 * Static metadata about a pipeline for tooling and introspection.
 * This metadata is captured during pipeline building and exposed on the pipeline instance.
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
  ProjectionTypes extends ProjectionTypeMap = ProjectionTypeMap,
> {
  /**
   * Logical name for this pipeline, used for logging/metrics.
   */
  name: string;
  /**
   * Aggregate type for this pipeline (e.g., "trace", "user").
   */
  aggregateType: AggregateType;
  eventStore: EventStore<EventType>;
  /**
   * Map of projection definitions for multiple projections support.
   * Each projection has a unique name, store, and handler.
   */
  projections?: ProjectionDefinitions<EventType, ProjectionTypes>;
  /**
   * Optional event publisher for publishing events to external systems.
   */
  eventPublisher?: EventPublisher<EventType>;
  /**
   * Map of event handler definitions for reacting to events.
   * Each handler processes individual events asynchronously via queues.
   */
  eventHandlers?: EventHandlerDefinitions<EventType>;
  /**
   * Optional queue processor factory for creating queues for event handlers.
   * If not provided, event handlers will be executed synchronously (not recommended for production).
   */
  queueProcessorFactory?: {
    create<Payload>(
      definition: EventSourcedQueueDefinition<Payload>,
    ): EventSourcedQueueProcessor<Payload>;
  };
  /**
   * Optional preconfigured checkpoint store. When provided we skip automatic
   * selection (memory vs ClickHouse) and use the supplied implementation as-is.
   */
  processorCheckpointStore?: ProcessorCheckpointStore;
  /**
   * Optional distributed lock for preventing concurrent updates.
   * Used for both projections and event handlers to serialize processing per aggregate.
   * If not provided, concurrent processing may result in ordering validation failures.
   */
  distributedLock?: DistributedLock;
  /**
   * Time-to-live for handler locks in milliseconds.
   * Prevents locks from being held indefinitely if a process crashes.
   * Default: 30 seconds
   */
  handlerLockTtlMs?: number;
  /**
   * Time-to-live for projection update locks in milliseconds.
   * Prevents locks from being held indefinitely if a process crashes.
   * Default: 5 minutes
   */
  updateLockTtlMs?: number;
  /**
   * Time-to-live for command locks in milliseconds.
   * Prevents locks from being held indefinitely if a process crashes.
   * Default: 30 seconds
   */
  commandLockTtlMs?: number;
  /**
   * Parent links defining relationships to other aggregate types.
   * Used by tools like deja-view to navigate between related aggregates.
   */
  parentLinks?: ParentLink<EventType>[];
  /**
   * Optional feature flag service for kill switches.
   * When provided, enables automatic feature flag-based kill switches for components.
   */
  featureFlagService?: FeatureFlagServiceInterface;
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
  /**
   * Parent links defining relationships to other aggregate types.
   * Used by tools like deja-view to navigate between related aggregates.
   */
  parentLinks: ParentLink<EventType>[];
  /**
   * Static metadata about this pipeline for tooling and introspection.
   * Available without triggering runtime initialization.
   */
  metadata: PipelineMetadata;
}

/**
 * Pipeline with command handlers attached under a `commands` property.
 * Dispatchers are accessible via `pipeline.commands.dispatcherName`.
 */
export type PipelineWithCommandHandlers<
  Pipeline extends RegisteredPipeline<any, any>,
  Dispatchers extends Record<string, EventSourcedQueueProcessor<any>>,
> = Pipeline & {
  commands: Dispatchers;
};
