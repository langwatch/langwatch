import type { Event, Projection } from "../../library/domain/types";
import type { AggregateType } from "../../library/domain/aggregateType";
import type { EventStore } from "../../library/stores/eventStore.types";
import type { EventSourcingService } from "../../library/services/eventSourcingService";
import type { ProjectionDefinitions } from "../../library/projection.types";
import type { EventHandlerDefinitions } from "../../library/eventHandler.types";
import type { EventPublisher } from "../../library/publishing/eventPublisher.types";
import type { DistributedLock } from "../../library/utils/distributedLock";
import type {
  EventSourcedQueueProcessor,
  EventSourcedQueueDefinition,
} from "../../library/queues";

export interface EventSourcingPipelineDefinition<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
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
  projections?: ProjectionDefinitions<EventType>;
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
}

export interface RegisteredPipeline<
  EventType extends Event = Event,
  ProjectionType extends Projection = Projection,
> {
  name: string;
  aggregateType: AggregateType;
  service: EventSourcingService<EventType, ProjectionType>;
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
