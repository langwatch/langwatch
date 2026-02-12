import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag";
import { createLogger } from "~/utils/logger/server";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, Projection } from "../domain/types";
import type { EventHandlerDefinition } from "../eventHandler.types";
import type { ProjectionDefinition } from "../projection.types";
import type { EventPublisher } from "../publishing/eventPublisher.types";
import type { ProcessorCheckpointStore } from "../stores/eventHandlerCheckpointStore.types";
import type {
  EventStore,
  EventStoreReadContext,
} from "../stores/eventStore.types";
import { EventUtils } from "../utils/event.utils";
import { BatchEventProcessor } from "./batch/batchEventProcessor";
import { CheckpointManager } from "./checkpoints/checkpointManager";
import { ConfigurationError } from "./errorHandling";
import type {
  EventSourcingOptions,
  EventSourcingServiceOptions,
  ReplayEventsOptions,
  UpdateProjectionOptions,
} from "./eventSourcingService.types";
import { EventHandlerDispatcher } from "./handlers/eventHandlerDispatcher";
import { ProjectionUpdater } from "./projections/projectionUpdater";
import { QueueProcessorManager } from "./queues/queueProcessorManager";
import { EventProcessorValidator } from "./validation/eventProcessorValidator";

/**
 * Main service that orchestrates event sourcing.
 * Coordinates between event stores, projection stores, and event handlers.
 */
export class EventSourcingService<
  EventType extends Event = Event,
  ProjectionTypes extends Record<string, Projection> = Record<
    string,
    Projection
  >,
> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-sourcing-service",
  );
  private readonly logger: ReturnType<typeof createLogger>;

  private readonly pipelineName: string;
  private readonly aggregateType: AggregateType;
  private readonly eventStore: EventStore<EventType>;
  private readonly projections?: Map<
    string,
    ProjectionDefinition<EventType, any>
  >;
  private readonly eventPublisher?: EventPublisher<EventType>;
  private readonly eventHandlers?: Map<
    string,
    EventHandlerDefinition<EventType>
  >;
  private readonly options: EventSourcingOptions<EventType>;
  private readonly queueManager: QueueProcessorManager<EventType>;
  private readonly handlerDispatcher: EventHandlerDispatcher<EventType>;
  private readonly projectionUpdater: ProjectionUpdater<
    EventType,
    ProjectionTypes
  >;
  private readonly featureFlagService?: FeatureFlagServiceInterface;
  private readonly projectionBatchProcessor?: BatchEventProcessor<EventType>;
  private readonly checkpointManager: CheckpointManager<EventType>;

  constructor({
    pipelineName,
    aggregateType,
    eventStore,
    projections,
    eventPublisher,
    eventHandlers,
    processorCheckpointStore,
    serviceOptions,
    logger,
    queueProcessorFactory,
    featureFlagService,
  }: EventSourcingServiceOptions<EventType, ProjectionTypes> & {
    processorCheckpointStore?: ProcessorCheckpointStore;
  }) {
    this.pipelineName = pipelineName;
    this.aggregateType = aggregateType;
    this.eventStore = eventStore;
    this.projections = projections
      ? new Map(Object.entries(projections))
      : void 0;
    this.eventPublisher = eventPublisher;
    this.eventHandlers = eventHandlers
      ? new Map(Object.entries(eventHandlers))
      : void 0;
    this.options = serviceOptions ?? {};
    this.logger =
      logger ??
      createLogger("langwatch.trace-processing.event-sourcing-service");
    this.featureFlagService = featureFlagService;

    // Warn in production if queue factory is not provided (handlers will be synchronous)
    if (
      process.env.NODE_ENV === "production" &&
      !queueProcessorFactory &&
      eventHandlers &&
      Object.keys(eventHandlers).length > 0
    ) {
      this.logger.warn(
        {
          aggregateType,
        },
        "[PERFORMANCE] EventSourcingService initialized without queue processor factory in production. Event handlers will be executed synchronously, blocking event storage. Consider providing a QueueProcessorFactory for async processing.",
      );
    }

    // Warn in production if queue factory is not provided (projections will be synchronous)
    if (
      process.env.NODE_ENV === "production" &&
      !queueProcessorFactory &&
      projections &&
      Object.keys(projections).length > 0
    ) {
      this.logger.warn(
        {
          aggregateType,
        },
        "[PERFORMANCE] EventSourcingService initialized without queue processor factory in production. Projections will be executed synchronously, blocking event storage. Consider providing a QueueProcessorFactory for async processing.",
      );
    }

    // Initialize components
    const validator = new EventProcessorValidator({
      eventStore,
      aggregateType,
      processorCheckpointStore,
      pipelineName: this.pipelineName,
    });

    this.checkpointManager = new CheckpointManager(
      this.pipelineName,
      processorCheckpointStore,
    );

    this.queueManager = new QueueProcessorManager<EventType>({
      aggregateType,
      pipelineName: this.pipelineName,
      queueProcessorFactory,
      featureFlagService: this.featureFlagService,
    });

    this.handlerDispatcher = new EventHandlerDispatcher<EventType>({
      aggregateType,
      eventHandlers: this.eventHandlers,
      queueManager: this.queueManager,
      featureFlagService: this.featureFlagService,
    });

    this.projectionUpdater = new ProjectionUpdater<EventType, ProjectionTypes>({
      aggregateType,
      eventStore,
      projections: this.projections,
      processorCheckpointStore,
      ordering: this.options.ordering ?? "timestamp",
      validator,
      checkpointManager: this.checkpointManager,
      queueManager: this.queueManager,
      featureFlagService: this.featureFlagService,
    });

    // Create batch processor for projection queue-based processing
    // Projections handle the BullMQ deduplication issue by fetching all unprocessed events
    if (queueProcessorFactory) {
      this.projectionBatchProcessor = new BatchEventProcessor<EventType>(
        eventStore,
        processorCheckpointStore,
        this.pipelineName,
        aggregateType,
      );
    }

    // Initialize queue processors for event handlers if factory is provided
    // Handler queues use SimpleBullmqQueueProcessor (no groupKey) - each event
    // is processed independently with no checkpoints or batch processing
    if (queueProcessorFactory && eventHandlers) {
      this.queueManager.initializeHandlerQueues(
        eventHandlers,
        async (handlerName, event, _context) => {
          const handlerDef = this.eventHandlers?.get(handlerName);
          if (!handlerDef) {
            throw new ConfigurationError(
              "EventSourcingService",
              `Handler "${handlerName}" not found`,
              { handlerName },
            );
          }
          await handlerDef.handler.handle(event);
        },
      );
    }

    // Initialize queue processors for projections if factory is provided
    if (queueProcessorFactory && projections) {
      this.queueManager.initializeProjectionQueues(
        projections,
        async (projectionName, triggerEvent, _context) => {
          // Use batch processor to handle all unprocessed events for this aggregate
          // The triggerEvent is just a trigger - we fetch all unprocessed events from the store
          if (this.projectionBatchProcessor) {
            await this.projectionBatchProcessor.processUnprocessedEvents(
              triggerEvent,
              projectionName,
              "projection",
              async (event, sequenceNumber, context) => {
                await this.processProjectionEvent(
                  projectionName,
                  event,
                  sequenceNumber,
                  context,
                );
              },
            );
          } else {
            // Fallback to single-event processing if no batch processor
            const projectionDef = this.projections?.get(projectionName);
            if (!projectionDef) {
              throw new ConfigurationError(
                "EventSourcingService",
                `Projection "${projectionName}" not found`,
                { projectionName },
              );
            }
            await this.projectionUpdater.processProjectionEvent(
              projectionName,
              projectionDef,
              triggerEvent,
              { tenantId: triggerEvent.tenantId },
            );
          }
        },
      );
    }
  }

  /**
   * Processes a single projection event within a batch.
   * Called by BatchEventProcessor for each unprocessed event.
   */
  private async processProjectionEvent(
    projectionName: string,
    event: EventType,
    sequenceNumber: number,
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    const projectionDef = this.projections?.get(projectionName);
    if (!projectionDef) {
      throw new ConfigurationError(
        "EventSourcingService",
        `Projection "${projectionName}" not found`,
        { projectionName },
      );
    }

    // Save pending checkpoint before processing
    await this.checkpointManager.saveCheckpointSafely(
      projectionName,
      "projection",
      event,
      "pending",
      sequenceNumber,
    );

    try {
      // Fetch ALL events for the aggregate, not just up to current event.
      // Using getEventsUpTo() misses concurrent events that share the same
      // timestamp but have a higher EventId than the trigger event, which
      // causes incomplete projections (e.g. trace summaries with fewer spans).
      // This matches BatchEventProcessor's approach (see its getEvents() call).
      const allEvents = await this.eventStore.getEvents(
        String(event.aggregateId),
        context,
        this.aggregateType,
      );

      // Update the projection with all events
      await this.projectionUpdater.updateProjectionByName(
        projectionName,
        String(event.aggregateId),
        context,
        { events: allEvents },
      );

      // Save processed checkpoint on success
      await this.checkpointManager.saveCheckpointSafely(
        projectionName,
        "projection",
        event,
        "processed",
        sequenceNumber,
      );
    } catch (error) {
      // Save failed checkpoint on error
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      await this.checkpointManager.saveCheckpointSafely(
        projectionName,
        "projection",
        event,
        "failed",
        sequenceNumber,
        errorMessage,
      );
      throw error;
    }
  }

  /**
   * Stores events using the pipeline's aggregate type.
   *
   * This method automatically uses the aggregate type configured for this pipeline,
   * preventing copy/paste mistakes where the wrong aggregate type is passed.
   *
   * **Execution Flow:**
   * 1. Events are stored in the event store (must succeed)
   * 2. Events are published to the event publisher (if configured) - errors are logged but don't fail
   * 3. Events are dispatched to event handlers (if configured) - errors are logged but don't fail
   * 4. Projections are automatically updated - errors are logged but don't fail
   *
   * **Concurrency:** Safe for concurrent calls with different aggregateIds. Concurrent calls for the same
   * aggregateId are safe at the event store level. Per-group ordering in GroupQueue serializes processing per aggregate.
   *
   * **Failure Modes:**
   * - Event store failures throw and prevent storage
   * - Publisher/handler/projection failures are logged but don't prevent storage
   * - Invalid tenantId throws before any operations
   *
   * **Performance:** O(n) where n is the number of events. Projection updates are O(m) where m is the
   * number of projections × number of unique aggregateIds in the event batch.
   *
   * @param events - Events to store
   * @param context - Security context with required tenantId
   * @throws {Error} If tenantId is invalid or event store operation fails
   */
  async storeEvents(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "EventSourcingService.storeEvents",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "event.types": [...new Set(events.map((e) => e.type))].join(","),
        },
      },
      async (span) => {
        EventUtils.validateTenantId(context, "storeEvents");

        // Enrich events with trace context if missing (for debugging)
        const enrichedEvents: EventType[] = events.map((event) => {
          const enrichedMetadata =
            EventUtils.buildEventMetadataWithCurrentProcessingTraceparent(
              event.metadata,
            );
          if (enrichedMetadata === event.metadata) {
            return event;
          }
          // Only add metadata property if enrichedMetadata has content
          const hasMetadata =
            enrichedMetadata &&
            Object.keys(enrichedMetadata as Record<string, unknown>).length > 0;
          if (!hasMetadata) {
            return event;
          }
          return {
            ...event,
            metadata: enrichedMetadata,
          };
        });

        span.addEvent("event_store.store.start");
        await this.eventStore.storeEvents(
          enrichedEvents,
          context,
          this.aggregateType,
        );
        span.addEvent("event_store.store.complete");

        // Publish events after successful storage
        if (this.eventPublisher && enrichedEvents.length > 0) {
          span.addEvent("publisher.publish.start");
          try {
            await this.eventPublisher.publish(enrichedEvents, context);
            span.addEvent("publisher.publish.complete");
          } catch (error) {
            span.addEvent("publisher.publish.error", {
              "error.message":
                error instanceof Error ? error.message : String(error),
            });
            // Log publishing errors but don't fail the storage operation
            if (this.logger) {
              this.logger.error(
                {
                  aggregateType: this.aggregateType,
                  eventCount: enrichedEvents.length,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Failed to publish events to external system",
              );
            }
          }
        }

        // Dispatch events to handlers after successful storage
        if (this.eventHandlers && enrichedEvents.length > 0) {
          span.addEvent("handler.dispatch.start");
          await this.handlerDispatcher.dispatchEventsToHandlers(
            enrichedEvents,
            context,
          );
          span.addEvent("handler.dispatch.complete");
        }

        if (this.projections && enrichedEvents.length > 0) {
          span.addEvent("projection.update.start");
          await this.projectionUpdater.updateProjectionsForAggregates(
            enrichedEvents,
            context,
          );
          span.addEvent("projection.update.complete");
        }
      },
    );
  }

  /**
   * Updates a specific projection by name for a given aggregate.
   *
   * This method processes all events for the aggregate and updates the projection state.
   * Projections are automatically updated after events are stored via storeEvents(),
   * but this method can be used for manual updates (e.g., recovery or reprocessing).
   *
   * **Concurrency:** Uses distributed lock (if configured) to prevent concurrent updates of the same
   * aggregate projection. The lock key includes the projection name to ensure different projections
   * for the same aggregate can be updated concurrently, while the same projection is updated serially.
   * Lock key format: `update:${aggregateType}:${aggregateId}:${projectionName}`
   * If lock acquisition fails, throws an error (caller should retry via queue).
   * Without a distributed lock, concurrent updates may result in lost updates (last write wins).
   *
   * **Performance:** O(n) where n is the number of events for the aggregate. Lock acquisition adds
   * network latency if using Redis-based locks.
   *
   * **Failure Modes:**
   * - Throws if projection name not found
   * - Throws if no events found for aggregate
   * - Throws if distributed lock cannot be acquired (if lock is configured)
   * - Throws if tenantId is invalid
   * - Projection store errors propagate (not caught)
   *
   * @param projectionName - The name of the projection to update
   * @param aggregateId - The aggregate to update projection for
   * @param context - Security context with required tenantId for event store access
   * @param options - Optional options including projection store context override
   * @returns Object containing both the updated projection and the events that were processed
   * @throws {Error} If projection name not found, no events found, lock acquisition fails, or tenantId is invalid
   */
  async updateProjectionByName<
    ProjectionName extends keyof ProjectionTypes & string,
  >(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    options?: UpdateProjectionOptions<EventType>,
  ): Promise<{
    projection: ProjectionTypes[ProjectionName];
    events: readonly EventType[];
  } | null> {
    return await this.projectionUpdater.updateProjectionByName(
      projectionName,
      aggregateId,
      context,
      options,
    );
  }

  /**
   * Gets a specific projection by name for a given aggregate.
   *
   * @param projectionName - The name of the projection to retrieve
   * @param aggregateId - The aggregate to get projection for
   * @param context - Security context with required tenantId
   * @returns The projection, or null if not found
   * @throws Error if projection name not found or not configured
   */
  async getProjectionByName<
    ProjectionName extends keyof ProjectionTypes & string,
  >(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<ProjectionTypes[ProjectionName] | null> {
    return this.projectionUpdater.getProjectionByName(
      projectionName,
      aggregateId,
      context,
    );
  }

  /**
   * Checks if a specific projection exists for a given aggregate.
   *
   * @param projectionName - The name of the projection to check
   * @param aggregateId - The aggregate to check projection for
   * @param context - Security context with required tenantId
   * @returns True if the projection exists, false otherwise
   * @throws Error if projection name not found or not configured
   */
  async hasProjectionByName<
    ProjectionName extends keyof ProjectionTypes & string,
  >(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<boolean> {
    return await this.projectionUpdater.hasProjectionByName(
      projectionName,
      aggregateId,
      context,
    );
  }

  /**
   * Gets the list of available projection names.
   *
   * @returns Array of projection names
   */
  getProjectionNames(): string[] {
    return this.projectionUpdater.getProjectionNames();
  }

  async replayEvents<ProjectionName extends keyof ProjectionTypes & string>(
    _projectionName: ProjectionName,
    _aggregateId: string,
    _context: EventStoreReadContext<EventType>,
    _options?: ReplayEventsOptions<EventType>,
  ): Promise<ProjectionTypes[ProjectionName]> {
    throw new ConfigurationError(
      "EventSourcingService",
      "Method not implemented",
    );
  }

  async replayEventsForHandler(
    _handlerName: string,
    _aggregateId: string,
    _context: EventStoreReadContext<EventType>,
    _options?: {
      fromEventId?: string;
    },
  ): Promise<void> {
    throw new ConfigurationError(
      "EventSourcingService",
      "Method not implemented",
    );
  }

  /**
   * Gets the queue processor manager for this service.
   * Used by the pipeline builder to initialize command queues.
   */
  getQueueManager(): QueueProcessorManager<EventType> {
    return this.queueManager;
  }

  /**
   * Gracefully closes all queue processors for event handlers, projections, and commands.
   * Should be called during application shutdown to ensure all queued jobs complete.
   */
  async close(): Promise<void> {
    await this.queueManager.close();
  }

  /**
   * Waits for all queue processors to be ready to accept jobs.
   * For BullMQ, this waits for workers to connect to Redis.
   * Should be called before sending commands in tests.
   */
  async waitUntilReady(): Promise<void> {
    await this.queueManager.waitUntilReady();
  }
}
