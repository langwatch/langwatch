import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { FeatureFlagServiceInterface } from "~/server/featureFlag";
import { createLogger } from "~/utils/logger/server";
import type { AggregateType } from "../domain/aggregateType";
import type { Event, Projection } from "../domain/types";
import type { EventPublisher } from "../eventPublisher.types";
import type { FoldProjectionDefinition } from "../projections/foldProjection.types";
import type { MapProjectionDefinition } from "../projections/mapProjection.types";
import { ProjectionRouter } from "../projections/projectionRouter";
import type { EventSourcedQueueProcessor } from "../queues";
import type { CheckpointStore } from "../stores/checkpointStore.types";
import type {
  EventStore,
  EventStoreReadContext,
} from "../stores/eventStore.types";
import { EventUtils } from "../utils/event.utils";
import { ProjectionBatchProcessor } from "./batch/projectionBatchProcessor";
import { ConfigurationError } from "./errorHandling";
import type {
  EventSourcingOptions,
  EventSourcingServiceOptions,
  UpdateProjectionOptions,
} from "./eventSourcingService.types";
import { QueueManager } from "./queues/queueManager";
import { ProjectionValidator } from "./validation/projectionValidator";

/**
 * Main service that orchestrates event sourcing.
 * Coordinates between event stores, projection stores, and event handlers.
 *
 * Uses ProjectionRouter for unified dispatch to both FoldProjections and MapProjections.
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
  private readonly eventPublisher?: EventPublisher<EventType>;
  private readonly options: EventSourcingOptions<EventType>;
  private readonly queueManager: QueueManager<EventType>;
  private readonly router: ProjectionRouter<EventType, ProjectionTypes>;
  private readonly featureFlagService?: FeatureFlagServiceInterface;
  private readonly checkpointStore?: CheckpointStore;

  constructor({
    pipelineName,
    aggregateType,
    eventStore,
    foldProjections,
    mapProjections,
    eventPublisher,
    checkpointStore,
    serviceOptions,
    logger,
    queueFactory,
    featureFlagService,
    commandRegistrations,
  }: EventSourcingServiceOptions<EventType, ProjectionTypes> & {
    checkpointStore?: CheckpointStore;
  }) {
    this.pipelineName = pipelineName;
    this.aggregateType = aggregateType;
    this.eventStore = eventStore;
    this.eventPublisher = eventPublisher;
    this.options = serviceOptions ?? {};
    this.logger =
      logger ??
      createLogger("langwatch.trace-processing.event-sourcing-service");
    this.featureFlagService = featureFlagService;
    this.checkpointStore = checkpointStore;

    // Warn in production if queue factory is not provided
    if (
      process.env.NODE_ENV === "production" &&
      !queueFactory &&
      ((foldProjections && foldProjections.length > 0) ||
        (mapProjections && mapProjections.length > 0))
    ) {
      this.logger.warn(
        { aggregateType },
        "[PERFORMANCE] EventSourcingService initialized without queue processor factory in production. Projections will be executed synchronously.",
      );
    }

    // Initialize components
    const validator = new ProjectionValidator({
      eventStore,
      aggregateType,
      checkpointStore,
      pipelineName: this.pipelineName,
    });

    this.queueManager = new QueueManager<EventType>({
      aggregateType,
      pipelineName: this.pipelineName,
      queueFactory,
      featureFlagService: this.featureFlagService,
    });

    // Create ProjectionRouter
    this.router = new ProjectionRouter<EventType, ProjectionTypes>(
      aggregateType,
      eventStore,
      pipelineName,
      this.queueManager,
      checkpointStore,
      featureFlagService,
      validator,
      (this.options.ordering ?? "timestamp") as "timestamp" | "as-is",
    );

    // Register fold projections
    if (foldProjections) {
      for (const fold of foldProjections) {
        this.router.registerFoldProjection(fold);
      }
    }

    // Register map projections
    if (mapProjections) {
      for (const mapProj of mapProjections) {
        this.router.registerMapProjection(mapProj);
      }
    }

    // Initialize queue processors for map projections (handler queues)
    if (queueFactory && mapProjections && mapProjections.length > 0) {
      this.router.initializeMapQueues();
    }

    // Initialize queue processors for fold projections (projection queues)
    if (queueFactory && foldProjections && foldProjections.length > 0) {
      const batchProcessor = new ProjectionBatchProcessor<EventType>(
        eventStore,
        checkpointStore,
        this.pipelineName,
        aggregateType,
      );
      this.router.initializeFoldQueues(batchProcessor);
    }

    // Initialize command queues (after all fields are set so storeEvents works)
    if (
      queueFactory &&
      commandRegistrations &&
      commandRegistrations.length > 0
    ) {
      this.queueManager.initializeCommandQueues(
        commandRegistrations,
        this.storeEvents.bind(this),
        pipelineName,
      );
    }
  }

  /**
   * Stores events using the pipeline's aggregate type.
   *
   * **Execution Flow:**
   * 1. Events are stored in the event store (must succeed)
   * 2. Events are published to the event publisher (if configured) - errors are logged but don't fail
   * 3. Events are dispatched to all projections via ProjectionRouter - errors are logged but don't fail
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

        // Dispatch events to all projections (fold + map) via unified router
        if (
          enrichedEvents.length > 0 &&
          (this.router.hasFoldProjections || this.router.hasMapProjections)
        ) {
          span.addEvent("projection.dispatch.start");
          await this.router.dispatch(enrichedEvents, context);
          span.addEvent("projection.dispatch.complete");
        }
      },
    );
  }

  /**
   * Updates a specific fold projection by name for a given aggregate.
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
    return await this.router.updateProjectionByName(
      projectionName,
      aggregateId,
      context,
      options,
    );
  }

  /**
   * Gets a specific fold projection by name for a given aggregate.
   */
  async getProjectionByName<
    ProjectionName extends keyof ProjectionTypes & string,
  >(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<ProjectionTypes[ProjectionName] | null> {
    return this.router.getProjectionByName(
      projectionName,
      aggregateId,
      context,
    );
  }

  /**
   * Checks if a specific fold projection exists for a given aggregate.
   */
  async hasProjectionByName<
    ProjectionName extends keyof ProjectionTypes & string,
  >(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<boolean> {
    return await this.router.hasProjectionByName(
      projectionName,
      aggregateId,
      context,
    );
  }

  /**
   * Gets the list of available projection names.
   */
  getProjectionNames(): string[] {
    return this.router.getProjectionNames();
  }

  /**
   * Gets the command queue dispatchers created during initialization.
   */
  getCommandQueues(): Map<string, EventSourcedQueueProcessor<any>> {
    return this.queueManager.getCommandQueues();
  }

  /**
   * Gracefully closes all queue processors.
   */
  async close(): Promise<void> {
    await this.queueManager.close();
  }

  /**
   * Waits for all queue processors to be ready to accept jobs.
   */
  async waitUntilReady(): Promise<void> {
    await this.queueManager.waitUntilReady();
  }
}
