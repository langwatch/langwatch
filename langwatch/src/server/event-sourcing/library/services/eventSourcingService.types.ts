import type { createLogger } from "../../../../utils/logger/server";
import type { FeatureFlagServiceInterface } from "../../../featureFlag/types";
import type { CommandHandlerClass } from "../commands/commandHandlerClass";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, EventOrderingStrategy } from "../domain/types";
import type { EventHandlerDefinitions } from "../eventHandler.types";
import type {
  ProjectionDefinitions,
  ProjectionTypeMap,
} from "../projection.types";
import type { EventPublisher } from "../eventPublisher.types";
import type { QueueProcessorFactory } from "../queues";
import type { EventStore } from "../stores/eventStore.types";
import type { ProjectionStoreReadContext } from "../stores/projectionStore.types";
import type { CommandHandlerOptions } from "./commands/commandDispatcher";
/**
 * Options for configuring event sourcing behavior.
 */
export interface EventSourcingOptions<EventType extends Event = Event> {
  /**
   * Strategy for ordering events when building projections.
   * Defaults to "timestamp" (chronological order).
   */
  ordering?: EventOrderingStrategy<EventType>;
}

/**
 * Options for updating a projection.
 */
export interface UpdateProjectionOptions<EventType extends Event = Event> {
  /**
   * Optional projection store context. If not provided, defaults to eventStoreContext.
   * Useful when projection store requires different tenant isolation or permissions.
   */
  projectionStoreContext?: ProjectionStoreReadContext;
  /**
   * Pre-fetched events to avoid duplicate query.
   * If provided, updateProjectionByName will use these events instead of fetching from the event store.
   */
  events?: readonly EventType[];
}

/**
 * Configuration options for EventSourcingService.
 */
export interface EventSourcingServiceOptions<
  EventType extends Event = Event,
  ProjectionTypes extends ProjectionTypeMap = ProjectionTypeMap,
> {
  /**
   * The pipeline name for this service.
   * Used for checkpoint key isolation between different pipelines.
   */
  pipelineName: string;
  /**
   * The aggregate type this service manages (e.g., "trace", "user").
   * Used for routing and event storage.
   */
  aggregateType: AggregateType;
  /**
   * Event store for persisting and retrieving events.
   * Must enforce tenant isolation.
   */
  eventStore: EventStore<EventType>;
  /**
   * Map of projection definitions for multiple projections support.
   * Each projection has a unique name, store, and handler.
   * Projections are automatically updated after events are stored.
   */
  projections?: ProjectionDefinitions<EventType, ProjectionTypes>;
  /**
   * Optional event publisher for publishing events to external systems.
   * Events are published after they are successfully stored.
   * Publishing errors are logged but do not fail the storage operation.
   */
  eventPublisher?: EventPublisher<EventType>;
  /**
   * Map of event handler definitions for reacting to events.
   * Handlers are dispatched asynchronously via queues after events are stored (if queueFactory is provided),
   * or synchronously as a fallback (not recommended for production).
   * Handler errors are logged but do not fail the storage operation.
   */
  eventHandlers?: EventHandlerDefinitions<EventType>;
  /**
   * Service-level options (e.g., event ordering strategy).
   */
  serviceOptions?: EventSourcingOptions<EventType>;

  /**
   * Optional logger for logging events and errors.
   * If not provided, a default logger will be used.
   */
  logger?: ReturnType<typeof createLogger>;

  /**
   * Optional queue factory for creating queues for event handlers.
   *
   * **Performance:** Without a queue factory, event handlers execute synchronously during event storage,
   * blocking the storage operation. This is not recommended for production.
   *
   * **Concurrency:** Queue processors handle retries, idempotency, and concurrency limits automatically.
   * Each handler gets its own queue, and handlers are processed in dependency order.
   */
  queueFactory?: QueueProcessorFactory;
  /**
   * Optional feature flag service for kill switches.
   * When provided, enables automatic feature flag-based kill switches for components.
   */
  featureFlagService?: FeatureFlagServiceInterface;
  /**
   * Command handler registrations for this pipeline.
   * Requires queueFactory to be set.
   */
  commandRegistrations?: Array<{
    name: string;
    handlerClass: CommandHandlerClass<any, any, EventType>;
    options?: CommandHandlerOptions<unknown>;
  }>;
}
