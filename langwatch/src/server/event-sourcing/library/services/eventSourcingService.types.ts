import type { createLogger } from "../../../../utils/logger";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, EventOrderingStrategy, Projection } from "../domain/types";
import type { EventHandlerDefinitions } from "../eventHandler.types";
import type {
  ProjectionDefinitions,
  ProjectionTypeMap,
} from "../projection.types";
import type { EventPublisher } from "../publishing/eventPublisher.types";
import type { EventSourcedQueueProcessor } from "../queues";
import type { EventStore } from "../stores/eventStore.types";
import type { ProjectionStoreReadContext } from "../stores/projectionStore.types";
import type { DistributedLock } from "../utils/distributedLock";

/**
 * Default time-to-live for distributed locks used during projection updates.
 * Prevents locks from being held indefinitely if a process crashes.
 */
export const DEFAULT_UPDATE_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
 * Options for replaying events (time travel).
 * Currently not implemented - throws "Not implemented" error.
 */
export interface ReplayEventsOptions<_EventType extends Event = Event> {
  /**
   * Replay events up to (and including) this timestamp.
   * If not provided, replays all events.
   */
  upToTimestamp?: number;
  /**
   * Optional projection store context. If not provided, defaults to eventStoreContext.
   */
  projectionStoreContext?: ProjectionStoreReadContext;
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
   * Handlers are dispatched asynchronously via queues after events are stored (if queueProcessorFactory is provided),
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
   * Required distributed lock for preventing concurrent updates of the same aggregate projection.
   *
   * **Concurrency:** The distributed lock ensures only one thread processes events for the same
   * aggregate at a time, preventing race conditions and ensuring correct failure handling.
   * Without a distributed lock, concurrent processing can cause events to be processed out of order
   * or fail to block on previous failures.
   *
   * **Lock Scope:** The lock is per-aggregate, allowing parallel processing across different aggregates.
   * This provides both safety and performance.
   *
   * **Failure Mode:** If lock acquisition fails, updateProjectionByName throws an error.
   * The caller should retry via queue processing.
   *
   * **Required:** This is now a required parameter. All deployments must provide a DistributedLock
   * implementation (e.g., Redis-based lock).
   */
  distributedLock: DistributedLock;
  /**
   * Time-to-live for update locks in milliseconds.
   * Prevents locks from being held indefinitely if a process crashes.
   * Default: 5 minutes
   */
  updateLockTtlMs?: number;
  /**
   * Time-to-live for handler locks in milliseconds.
   * Prevents locks from being held indefinitely if a process crashes.
   * Default: 30 seconds
   */
  handlerLockTtlMs?: number;
  /**
   * Time-to-live for command locks in milliseconds.
   * Prevents locks from being held indefinitely if a process crashes.
   * Default: 30 seconds
   */
  commandLockTtlMs?: number;
  /**
   * Optional queue processor factory for creating queues for event handlers.
   *
   * **Performance:** Without a queue factory, event handlers execute synchronously during event storage,
   * blocking the storage operation. This is not recommended for production.
   *
   * **Concurrency:** Queue processors handle retries, idempotency, and concurrency limits automatically.
   * Each handler gets its own queue, and handlers are processed in dependency order.
   */
  queueProcessorFactory?: {
    create<Payload>(definition: {
      name: string;
      process: (payload: Payload) => Promise<void>;
      makeJobId?: (payload: Payload) => string;
      delay?: number;
      options?: { concurrency?: number };
      spanAttributes?: (
        payload: Payload,
      ) => Record<string, string | number | boolean>;
    }): EventSourcedQueueProcessor<Payload>;
  };
}
