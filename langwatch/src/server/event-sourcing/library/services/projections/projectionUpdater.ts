import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Event, EventOrderingStrategy } from "../../domain/types";
import type { EventStream } from "../../streams/eventStream";
import type { AggregateType } from "../../domain/aggregateType";
import type { TenantId } from "../../domain/tenantId";
import type { EventStore } from "../../stores/eventStore.types";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import type { ProcessorCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";
import type { ProjectionDefinition } from "../../projection.types";
import type { UpdateProjectionOptions } from "../eventSourcingService.types";
import { EventUtils } from "../../utils/event.utils";
import type { DistributedLock } from "../../utils/distributedLock";
import { createLogger } from "~/utils/logger";
import { type EventProcessorValidator } from "../validation/eventProcessorValidator";
import { type CheckpointManager } from "../checkpoints/checkpointManager";
import { type QueueProcessorManager } from "../queues/queueProcessorManager";
import {
  ErrorCategory,
  handleError,
  isSequentialOrderingError,
  ConfigurationError,
  LockError,
  ValidationError,
} from "../errorHandling";

/**
 * Manages projection updates for event sourcing.
 * Handles both synchronous and asynchronous (queue-based) projection updates.
 */
export class ProjectionUpdater<EventType extends Event = Event> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.projection-updater",
  );
  private readonly logger = createLogger(
    "langwatch:event-sourcing:projection-updater",
  );
  private readonly aggregateType: AggregateType;
  private readonly eventStore: EventStore<EventType>;
  private readonly projections?: Map<
    string,
    ProjectionDefinition<EventType, any>
  >;
  private readonly processorCheckpointStore?: ProcessorCheckpointStore;
  private readonly distributedLock?: DistributedLock;
  private readonly updateLockTtlMs: number;
  private readonly ordering: EventOrderingStrategy<EventType>;
  private readonly validator: EventProcessorValidator<EventType>;
  private readonly checkpointManager: CheckpointManager<EventType>;
  private readonly queueManager: QueueProcessorManager<EventType>;

  constructor({
    aggregateType,
    eventStore,
    projections,
    processorCheckpointStore,
    distributedLock,
    updateLockTtlMs,
    ordering,
    validator,
    checkpointManager,
    queueManager,
  }: {
    aggregateType: AggregateType;
    eventStore: EventStore<EventType>;
    projections?: Map<string, ProjectionDefinition<EventType, any>>;
    processorCheckpointStore?: ProcessorCheckpointStore;
    distributedLock?: DistributedLock;
    updateLockTtlMs: number;
    ordering: EventOrderingStrategy<EventType>;
    validator: EventProcessorValidator<EventType>;
    checkpointManager: CheckpointManager<EventType>;
    queueManager: QueueProcessorManager<EventType>;
  }) {
    this.aggregateType = aggregateType;
    this.eventStore = eventStore;
    this.projections = projections;
    this.processorCheckpointStore = processorCheckpointStore;
    this.distributedLock = distributedLock;
    this.updateLockTtlMs = updateLockTtlMs;
    this.ordering = ordering;
    this.validator = validator;
    this.checkpointManager = checkpointManager;
    this.queueManager = queueManager;
  }

  /**
   * Updates all registered projections for aggregates affected by the given events.
   *
   * If queue processors are available, events are dispatched to queues asynchronously.
   * Otherwise, projections are updated inline (fallback for backwards compatibility).
   *
   * **Concurrency:** Projection updates for different aggregates run concurrently.
   * Updates for the same aggregate are serialized via distributed lock (if configured).
   *
   * **Failure Modes:**
   * - Errors in individual projection updates are logged but don't fail the operation
   * - Lock acquisition failures throw (but are caught and logged at this level)
   */
  async updateProjectionsForAggregates(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    if (!this.projections || this.projections.size === 0) {
      return;
    }

    return await this.tracer.withActiveSpan(
      "ProjectionUpdater.updateProjectionsForAggregates",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "projection.count": this.projections.size,
          "dispatch.mode":
            this.queueManager.getProjectionQueueProcessors().size > 0
              ? "async"
              : "sync",
        },
      },
      async (span) => {
        EventUtils.validateTenantId(context, "updateProjectionsForAggregates");

        // If queue processors are available, use async queue-based dispatch
        if (this.queueManager.getProjectionQueueProcessors().size > 0) {
          await this.dispatchEventsToProjectionQueues(events);
          return;
        }

        // Fallback: inline processing (for backwards compatibility or when no queue factory provided)
        const eventsByAggregate = new Map<string, EventType[]>();
        for (const event of events) {
          const aggregateId = String(event.aggregateId);
          if (!eventsByAggregate.has(aggregateId)) {
            eventsByAggregate.set(aggregateId, []);
          }
          eventsByAggregate.get(aggregateId)!.push(event);
        }

        span.setAttributes({
          "aggregate.count": eventsByAggregate.size,
        });

        for (const aggregateId of eventsByAggregate.keys()) {
          const eventsForAggregate = eventsByAggregate.get(aggregateId)!;
          // For inline processing, checkpoint per event (similar to queue processing)
          for (const event of eventsForAggregate) {
            for (const projectionName of this.projections!.keys()) {
              try {
                span.addEvent("projection.update.aggregate.start", {
                  "projection.name": projectionName,
                  "aggregate.id": aggregateId,
                });
                // Use processProjectionEvent for inline processing to get checkpointing
                const projectionDef = this.projections!.get(projectionName);
                if (projectionDef) {
                  await this.processProjectionEvent(
                    projectionName,
                    projectionDef,
                    event,
                    context,
                  );
                }
                span.addEvent("projection.update.aggregate.complete", {
                  "projection.name": projectionName,
                  "aggregate.id": aggregateId,
                });
              } catch (error) {
                // Determine error category and handle accordingly
                const category = isSequentialOrderingError(error)
                  ? ErrorCategory.CRITICAL
                  : ErrorCategory.NON_CRITICAL;

                span.addEvent("projection.update.aggregate.error", {
                  "projection.name": projectionName,
                  "aggregate.id": aggregateId,
                  "error.category": category,
                  "error.message":
                    error instanceof Error ? error.message : String(error),
                });

                handleError(error, category, this.logger, {
                  projectionName,
                  aggregateId,
                  tenantId: context.tenantId,
                });
                // If error was non-critical, processing continues
              }
            }
          }
        }
      },
    );
  }

  /**
   * Dispatches events to projection queues asynchronously.
   * Events are queued immediately and processed asynchronously by workers.
   */
  private async dispatchEventsToProjectionQueues(
    events: readonly EventType[],
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "ProjectionUpdater.dispatchEventsToProjectionQueues",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "projection.count":
            this.queueManager.getProjectionQueueProcessors().size,
        },
      },
      async (span) => {
        if (!this.projections) {
          return;
        }

        // Dispatch events to queues
        for (const event of events) {
          for (const projectionName of this.projections.keys()) {
            // Check if processing should continue (no failed events for this aggregate)
            if (this.processorCheckpointStore) {
              const hasFailures =
                await this.processorCheckpointStore.hasFailedEvents(
                  this.checkpointManager.getPipelineName(),
                  projectionName,
                  "projection",
                  event.tenantId,
                  this.aggregateType,
                  String(event.aggregateId),
                );

              if (hasFailures) {
                // For projections, skip processing gracefully (don't throw)
                // This allows storeEvents to succeed even when processing is skipped
                this.logger.warn(
                  {
                    projectionName,
                    eventId: event.id,
                    aggregateId: String(event.aggregateId),
                    tenantId: event.tenantId,
                  },
                  "Skipping event dispatch to projection queue due to previous failures for this aggregate",
                );
                continue;
              }
            }
            const queueProcessor =
              this.queueManager.getProjectionQueueProcessor(projectionName);
            if (!queueProcessor) {
              this.logger.warn(
                {
                  projectionName,
                  eventType: event.type,
                },
                "Queue processor not found for projection, skipping",
              );
              continue;
            }

            try {
              span.addEvent("projection.queue.send", {
                "projection.name": projectionName,
                "event.type": event.type,
                "event.id": event.id,
                "event.aggregate_id": String(event.aggregateId),
              });
              await queueProcessor.send(event);
            } catch (error) {
              span.addEvent("projection.queue.send.error", {
                "projection.name": projectionName,
                "event.type": event.type,
                "error.message":
                  error instanceof Error ? error.message : String(error),
              });
              // Queue processor handles retries internally
              if (this.logger) {
                this.logger.error(
                  {
                    projectionName,
                    eventType: event.type,
                    aggregateId: String(event.aggregateId),
                    tenantId: event.tenantId,
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                  "Failed to dispatch event to projection queue",
                );
              }
            }
          }
        }
      },
    );
  }

  /**
   * Processes a single event for a projection and updates checkpoint on success.
   * Implements per-event checkpointing with failure detection.
   * Uses shared validation and checkpointing logic via validateEventProcessing and saveCheckpointSafely.
   * Note: Projections rebuild from all events for the aggregate, but we checkpoint per-event
   * to track which events have been processed and detect failures.
   */
  async processProjectionEvent(
    projectionName: string,
    projectionDef: ProjectionDefinition<EventType, any>,
    event: EventType,
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "ProjectionUpdater.processProjectionEvent",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "projection.name": projectionName,
          "event.id": event.id,
          "event.aggregate_id": String(event.aggregateId),
          "event.timestamp": event.timestamp,
          "event.type": event.type,
          "event.tenant_id": event.tenantId,
        },
      },
      async () => {
        EventUtils.validateTenantId(context, "processProjectionEvent");

        // Validate event processing prerequisites (sequence number, idempotency, ordering)
        const sequenceNumber = await this.validator.validateEventProcessing(
          projectionName,
          "projection",
          event,
          context,
        );

        this.logger.debug(
          {
            projectionName,
            eventId: event.id,
            sequenceNumber: sequenceNumber ?? null,
          },
          "Validation result",
        );

        // If validation returned null, processing should be skipped (already processed or has failures)
        if (sequenceNumber === null) {
          this.logger.debug(
            {
              projectionName,
              eventId: event.id,
            },
            "Skipping processing (already processed or has failures)",
          );
          return;
        }

        try {
          // Save checkpoint as "pending" before processing
          await this.checkpointManager.saveCheckpointSafely(
            projectionName,
            "projection",
            event,
            "pending",
            sequenceNumber,
          );

          // Rebuild projection from all events for the aggregate
          await this.updateProjectionByName(
            projectionName,
            String(event.aggregateId),
            context,
          );

          // Save checkpoint as "processed" on success
          await this.checkpointManager.saveCheckpointSafely(
            projectionName,
            "projection",
            event,
            "processed",
            sequenceNumber,
          );

          this.logger.debug(
            {
              projectionName,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
              eventType: event.type,
            },
            "Saved processed checkpoint for projection",
          );
        } catch (error) {
          // Save checkpoint as "failed" on failure
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

          this.logger.error(
            {
              projectionName,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
              error: errorMessage,
            },
            "Failed to process event for projection",
          );

          // Throw to stop queue processing
          throw error;
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
   * @returns The updated projection
   * @throws {Error} If projection name not found, no events found, lock acquisition fails, or tenantId is invalid
   */
  async updateProjectionByName<ProjectionName extends string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
    options?: UpdateProjectionOptions<EventType>,
  ): Promise<any> {
    EventUtils.validateTenantId(options?.projectionStoreContext ?? context, "updateProjectionByName");

    if (!this.projections) {
      throw new ConfigurationError(
        "EventSourcingService",
        "EventSourcingService.updateProjectionByName requires multiple projections to be configured",
      );
    }

    const projectionDef = this.projections.get(projectionName);
    if (!projectionDef) {
      const availableNames = Array.from(this.projections.keys()).join(", ");
      throw new ConfigurationError(
        "ProjectionUpdater",
        `Projection "${projectionName}" not found. Available projections: ${
          availableNames || "none"
        }`,
        { projectionName },
      );
    }

    return await this.tracer.withActiveSpan(
      "ProjectionUpdater.updateProjection",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "projection.name": projectionName,
          "aggregate.id": String(aggregateId),
          "tenant.id": context.tenantId,
        },
      },
      async (span) => {
        const lockKey = `update:${context.tenantId}:${this.aggregateType}:${String(
          aggregateId,
        )}:${projectionName}`;
        const lockHandle = this.distributedLock
          ? await this.distributedLock.acquire(lockKey, this.updateLockTtlMs)
          : null;

        if (this.distributedLock && !lockHandle) {
          throw new LockError(
            lockKey,
            "updateProjection",
            `Cannot acquire lock for projection update: ${lockKey}. Another process is updating this projection. Will retry.`,
            {
              projectionName,
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
            },
          );
        }

        try {
          const startTime = Date.now();

          this.logger.debug(
            {
              projectionName,
              aggregateId: String(aggregateId),
              tenantId: context.tenantId,
            },
            "Updating projection",
          );

          span.addEvent("event_store.fetch.start");
          const events = await this.eventStore.getEvents(
            aggregateId,
            context,
            this.aggregateType,
          );
          span.addEvent("event_store.fetch.complete", {
            "event.count": events.length,
          });

          if (events.length === 0) {
            throw new ValidationError(
              `No events found for aggregate ${String(aggregateId)}`,
              "events",
              void 0,
              {
                aggregateId: String(aggregateId),
                tenantId: context.tenantId,
                projectionName,
              },
            );
          }

          const stream = this.createEventStream(
            aggregateId,
            context.tenantId,
            events,
          );
          const metadata = EventUtils.buildProjectionMetadata(stream);

          span.setAttributes({
            "event.count": metadata.eventCount,
            "event.first_timestamp": metadata.firstEventTimestamp ?? void 0,
            "event.last_timestamp": metadata.lastEventTimestamp ?? void 0,
          });

          this.logger.debug(
            {
              projectionName,
              aggregateId: String(aggregateId),
              eventCount: metadata.eventCount,
            },
            "Loaded events for projection update",
          );

          span.addEvent("event_handler.handle.start");
          const projection = await projectionDef.handler.handle(stream);
          span.addEvent("event_handler.handle.complete");

          span.setAttributes({
            "projection.id": projection.id,
            "projection.version": projection.version,
          });

          const projectionContext = options?.projectionStoreContext ?? context;
          EventUtils.validateTenantId(
            projectionContext,
            "updateProjectionByName",
          );

          span.addEvent("projection_store.store.start");
          await projectionDef.store.storeProjection(
            projection,
            projectionContext,
          );
          span.addEvent("projection_store.store.complete");

          const durationMs = Date.now() - startTime;

          // Extract projection state for logging (if available)
          const projectionState =
            projection.data &&
            typeof projection.data === "object" &&
            "aggregationStatus" in projection.data
              ? (projection.data as { aggregationStatus?: string })
                  .aggregationStatus
              : void 0;

          this.logger.debug(
            {
              projectionName,
              aggregateId: String(aggregateId),
              projectionId: projection.id,
              projectionVersion: projection.version,
              projectionState,
              eventCount: metadata.eventCount,
              durationMs,
            },
            "Projection update completed",
          );

          // Log state transition if state is available
          if (projectionState) {
            this.logger.debug(
              {
                projectionName,
                aggregateId: String(aggregateId),
                projectionState,
                eventType: events[events.length - 1]?.type,
                eventCount: metadata.eventCount,
              },
              "Projection state transition",
            );
          }

          return projection;
        } finally {
          if (lockHandle) {
            try {
              await this.distributedLock!.release(lockHandle);
            } catch (error) {
              // Update already completed successfully; lock release failure is non-critical
              this.logger.error(
                {
                  projectionName,
                  aggregateId: String(aggregateId),
                  tenantId: context.tenantId,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Failed to release distributed lock after projection update",
              );
            }
          }
        }
      },
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
  async getProjectionByName<ProjectionName extends string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<unknown> {
    EventUtils.validateTenantId(context, "getProjectionByName");

    if (!this.projections) {
      throw new ConfigurationError(
        "EventSourcingService",
        "EventSourcingService.getProjectionByName requires multiple projections to be configured",
      );
    }

    const projectionDef = this.projections.get(projectionName);
    if (!projectionDef) {
      const availableNames = Array.from(this.projections.keys()).join(", ");
      throw new ConfigurationError(
        "ProjectionUpdater",
        `Projection "${projectionName}" not found. Available projections: ${
          availableNames || "none"
        }`,
        { projectionName },
      );
    }

    return await this.tracer.withActiveSpan(
      "ProjectionUpdater.getProjectionByName",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "projection.name": projectionName,
          "aggregate.id": aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async () => {
        const projectionContext = context;
        EventUtils.validateTenantId(projectionContext, "getProjectionByName");

        return await projectionDef.store.getProjection(
          aggregateId,
          projectionContext,
        );
      },
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
  async hasProjectionByName<ProjectionName extends string>(
    projectionName: ProjectionName,
    aggregateId: string,
    context: EventStoreReadContext<EventType>,
  ): Promise<boolean> {
    EventUtils.validateTenantId(context, "hasProjectionByName");

    if (!this.projections) {
      throw new ConfigurationError(
        "EventSourcingService",
        "EventSourcingService.hasProjectionByName requires multiple projections to be configured",
      );
    }

    const projectionDef = this.projections.get(projectionName);
    if (!projectionDef) {
      const availableNames = Array.from(this.projections.keys()).join(", ");
      throw new ConfigurationError(
        "ProjectionUpdater",
        `Projection "${projectionName}" not found. Available projections: ${
          availableNames || "none"
        }`,
        { projectionName },
      );
    }

    return await this.tracer.withActiveSpan(
      "ProjectionUpdater.hasProjectionByName",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "projection.name": projectionName,
          "aggregate.id": aggregateId,
          "tenant.id": context.tenantId,
        },
      },
      async (span) => {
        const projection = await projectionDef.store.getProjection(
          aggregateId,
          context,
        );
        const exists = projection !== null;
        span.setAttributes({
          "projection.exists": exists,
        });
        return exists;
      },
    );
  }

  /**
   * Gets the list of available projection names.
   *
   * @returns Array of projection names
   */
  getProjectionNames(): string[] {
    if (!this.projections) {
      return [];
    }
    return Array.from(this.projections.keys());
  }

  /**
   * Creates an event stream from events.
   */
  private createEventStream(
    aggregateId: string,
    tenantId: TenantId,
    events: readonly EventType[],
  ): EventStream<TenantId, EventType> {
    return EventUtils.createEventStream(
      aggregateId,
      tenantId,
      events,
      this.ordering,
    );
  }
}
