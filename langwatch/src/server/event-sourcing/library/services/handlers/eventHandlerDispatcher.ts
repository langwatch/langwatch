import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type { Event } from "../../domain/types";
import type { AggregateType } from "../../domain/aggregateType";
import type { EventStoreReadContext } from "../../stores/eventStore.types";
import type { ProcessorCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";
import type { EventHandlerDefinition } from "../../eventHandler.types";
import { createLogger } from "~/utils/logger";
import { type EventProcessorValidator } from "../validation/eventProcessorValidator";
import { type CheckpointManager } from "../checkpoints/checkpointManager";
import { type QueueProcessorManager } from "../queues/queueProcessorManager";
import {
  ErrorCategory,
  handleError,
  isSequentialOrderingError,
  SequentialOrderingError,
  LockError,
} from "../errorHandling";
import { buildCheckpointKey } from "../../utils/checkpointKey";
import type { DistributedLock } from "../../utils/distributedLock";

/**
 * Dispatches events to registered event handlers.
 * Handles both synchronous and asynchronous (queue-based) dispatch modes.
 */
export class EventHandlerDispatcher<EventType extends Event = Event> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.trace-processing.event-handler-dispatcher",
  );
  private readonly logger = createLogger(
    "langwatch:event-sourcing:event-handler-dispatcher",
  );
  private readonly aggregateType: AggregateType;
  private readonly eventHandlers?: Map<
    string,
    EventHandlerDefinition<EventType>
  >;
  private readonly processorCheckpointStore?: ProcessorCheckpointStore;
  private readonly validator: EventProcessorValidator<EventType>;
  private readonly checkpointManager: CheckpointManager<EventType>;
  private readonly queueManager: QueueProcessorManager<EventType>;
  private readonly distributedLock?: DistributedLock;
  private readonly handlerLockTtlMs: number;

  constructor({
    aggregateType,
    eventHandlers,
    processorCheckpointStore,
    validator,
    checkpointManager,
    queueManager,
    distributedLock,
    handlerLockTtlMs = 30000,
  }: {
    aggregateType: AggregateType;
    eventHandlers?: Map<string, EventHandlerDefinition<EventType>>;
    processorCheckpointStore?: ProcessorCheckpointStore;
    validator: EventProcessorValidator<EventType>;
    checkpointManager: CheckpointManager<EventType>;
    queueManager: QueueProcessorManager<EventType>;
    distributedLock?: DistributedLock;
    handlerLockTtlMs?: number;
  }) {
    this.aggregateType = aggregateType;
    this.eventHandlers = eventHandlers;
    this.processorCheckpointStore = processorCheckpointStore;
    this.validator = validator;
    this.checkpointManager = checkpointManager;
    this.queueManager = queueManager;
    this.distributedLock = distributedLock;
    this.handlerLockTtlMs = handlerLockTtlMs;
  }

  /**
   * Dispatches events to registered event handlers.
   *
   * If queue processors are available, events are dispatched asynchronously via queues.
   * Otherwise, handlers are executed synchronously (fallback for backwards compatibility).
   *
   * **Concurrency:** Handlers are processed in registration order.
   * With queues, handlers process events concurrently up to their concurrency limits.
   * Without queues, handlers execute sequentially per event.
   *
   * **Failure Modes:**
   * - Handler errors are logged but don't fail the dispatch operation
   * - Queue dispatch errors are logged but don't fail (queue processor handles retries)
   * - Dependent handlers still execute even if a dependency fails (they should handle missing data gracefully)
   */
  async dispatchEventsToHandlers(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    if (!this.eventHandlers || this.eventHandlers.size === 0) {
      return;
    }

    return await this.tracer.withActiveSpan(
      "EventHandlerDispatcher.dispatchEventsToHandlers",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "handler.count": this.eventHandlers.size,
          "dispatch.mode":
            this.queueManager.getHandlerQueueProcessors().size > 0
              ? "async"
              : "sync",
        },
      },
      async () => {
        // If queue processors are available, use async queue-based dispatch
        if (this.queueManager.getHandlerQueueProcessors().size > 0) {
          await this.dispatchEventsToQueues(events);
          return;
        }

        // Fallback: synchronous dispatch (for backwards compatibility or when no queue factory provided)
        await this.dispatchEventsSynchronously(events, context);
      },
    );
  }

  /**
   * Dispatches events to handler queues asynchronously.
   * Events are queued immediately and processed asynchronously by workers.
   */
  private async dispatchEventsToQueues(
    events: readonly EventType[],
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "EventHandlerDispatcher.dispatchEventsToQueues",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "handler.count": this.queueManager.getHandlerQueueProcessors().size,
        },
      },
      async (span) => {
        const sortedHandlers = this.getHandlerNames();

        // Dispatch events to queues in registration order (actual processing order maintained by queue workers)
        for (const event of events) {
          for (const handlerName of sortedHandlers) {
            // Check if processing should continue (no failed events for this aggregate)
            if (this.processorCheckpointStore) {
              const hasFailures =
                await this.processorCheckpointStore.hasFailedEvents(
                  this.checkpointManager.getPipelineName(),
                  handlerName,
                  "handler",
                  event.tenantId,
                  this.aggregateType,
                  event.aggregateId,
                );

              if (hasFailures) {
                // For handlers, skip processing gracefully (don't throw)
                // This allows storeEvents to succeed even when processing is skipped
                this.logger.warn(
                  {
                    handlerName,
                    eventId: event.id,
                    aggregateId: String(event.aggregateId),
                    tenantId: event.tenantId,
                  },
                  "Skipping event dispatch due to previous failures for this aggregate",
                );
                continue;
              }
            }
            const handlerDef = this.eventHandlers?.get(handlerName);
            if (!handlerDef) {
              continue;
            }

            // Get event types this handler is interested in
            const handlerEventTypes = this.getHandlerEventTypes(handlerDef);

            // Filter by event type if handler specifies event types
            if (handlerEventTypes && handlerEventTypes.length > 0) {
              if (!handlerEventTypes.includes(event.type)) {
                continue;
              }
            }

            const queueProcessor =
              this.queueManager.getHandlerQueueProcessor(handlerName);
            if (!queueProcessor) {
              this.logger.warn(
                {
                  handlerName,
                  eventType: event.type,
                },
                "Queue processor not found for handler, skipping",
              );
              continue;
            }

            try {
              span.addEvent("handler.queue.send", {
                "handler.name": handlerName,
                "event.type": event.type,
                "event.id": event.id,
                "event.aggregate_id": String(event.aggregateId),
              });
              await queueProcessor.send(event);
            } catch (error) {
              span.addEvent("handler.queue.send.error", {
                "handler.name": handlerName,
                "event.type": event.type,
                "error.message":
                  error instanceof Error ? error.message : String(error),
              });
              // Queue processor handles retries internally
              if (this.logger) {
                this.logger.error(
                  {
                    handlerName,
                    eventType: event.type,
                    aggregateId: String(event.aggregateId),
                    tenantId: event.tenantId,
                    error:
                      error instanceof Error ? error.message : String(error),
                  },
                  "Failed to dispatch event to handler queue",
                );
              }
            }
          }
        }
      },
    );
  }

  /**
   * Dispatches events to handlers synchronously (fallback mode).
   * Used when no queue processor factory is provided.
   */
  private async dispatchEventsSynchronously(
    events: readonly EventType[],
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    return await this.tracer.withActiveSpan(
      "EventHandlerDispatcher.dispatchEventsSynchronously",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "aggregate.type": this.aggregateType,
          "event.count": events.length,
          "tenant.id": context.tenantId,
          "handler.count": this.eventHandlers?.size ?? 0,
        },
      },
      async (span) => {
        const sortedHandlers = this.getHandlerNames();

        for (const event of events) {
          for (const handlerName of sortedHandlers) {
            const handlerDef = this.eventHandlers?.get(handlerName);
            if (!handlerDef) {
              continue;
            }

            const handlerEventTypes = this.getHandlerEventTypes(handlerDef);

            if (handlerEventTypes && handlerEventTypes.length > 0) {
              if (!handlerEventTypes.includes(event.type)) {
                continue;
              }
            }

            try {
              span.addEvent("handler.handle.start", {
                "handler.name": handlerName,
                "event.type": event.type,
                "event.id": event.id,
                "event.aggregate_id": String(event.aggregateId),
              });
              await this.handleEvent(handlerName, handlerDef, event, context);
              span.addEvent("handler.handle.complete", {
                "handler.name": handlerName,
              });
            } catch (error) {
              // Determine error category and handle accordingly
              const category = isSequentialOrderingError(error)
                ? ErrorCategory.CRITICAL
                : ErrorCategory.NON_CRITICAL;

              this.logger.debug(
                {
                  handlerName,
                  eventId: event.id,
                  category,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Error caught in event handler",
              );

              span.addEvent("handler.handle.error", {
                "handler.name": handlerName,
                "event.type": event.type,
                "error.category": category,
                "error.message":
                  error instanceof Error ? error.message : String(error),
              });

              // handleError throws for CRITICAL errors, so we need to let it propagate
              // For non-critical errors, it logs but doesn't throw, so processing continues
              try {
                handleError(error, category, this.logger, {
                  handlerName,
                  eventType: event.type,
                  aggregateId: String(event.aggregateId),
                  tenantId: event.tenantId,
                });
                this.logger.debug(
                  {
                    handlerName,
                    eventId: event.id,
                  },
                  "handleError completed (non-critical)",
                );
              } catch (rethrownError) {
                this.logger.debug(
                  {
                    handlerName,
                    eventId: event.id,
                    error:
                      rethrownError instanceof Error
                        ? rethrownError.message
                        : String(rethrownError),
                  },
                  "handleError rethrew (critical)",
                );
                throw rethrownError;
              }
              // If error was non-critical, processing continues
              // Dependent handlers still execute even if a dependency fails
            }
          }
        }
      },
    );
  }

  /**
   * Gets handler names in registration order.
   *
   * @returns Handler names in registration order
   */
  private getHandlerNames(): string[] {
    if (!this.eventHandlers || this.eventHandlers.size === 0) {
      return [];
    }
    return Array.from(this.eventHandlers.keys());
  }

  /**
   * Calculates the lock TTL based on sequence number and base processing time.
   * Later sequence numbers may need more time if they had to wait for previous events.
   *
   * @param sequenceNumber - The sequence number of the event
   * @param baseTtlMs - Base TTL in milliseconds
   * @returns Adjusted TTL in milliseconds
   */
  private calculateLockTtl(sequenceNumber: number, baseTtlMs: number): number {
    // Base TTL covers normal processing time
    // Add buffer for checkpoint operations (2 seconds)
    const checkpointBufferMs = 2000;

    // For later sequence numbers, add a small buffer per sequence position
    // This accounts for potential waiting time and ensures lock doesn't expire
    // during processing even if there was some delay
    const sequenceBufferMs =
      sequenceNumber > 1 ? (sequenceNumber - 1) * 500 : 0;

    const calculatedTtl = baseTtlMs + checkpointBufferMs + sequenceBufferMs;

    // Cap at reasonable maximum (5 minutes) to prevent excessively long locks
    return Math.min(calculatedTtl, 5 * 60 * 1000);
  }

  /**
   * Checks if the previous event has been processed before acquiring a lock.
   * This allows early bailout to avoid lock contention when we know processing will fail.
   *
   * Includes a brief retry loop to account for eventual consistency in checkpoint stores
   * (e.g., ClickHouse replication delay).
   *
   * @param handlerName - Name of the handler
   * @param event - The event to check
   * @param sequenceNumber - The sequence number of the event
   * @returns True if previous event is processed or sequence is 1, false otherwise
   */
  private async checkPreviousEventProcessed(
    handlerName: string,
    event: EventType,
    sequenceNumber: number,
  ): Promise<boolean> {
    if (!this.processorCheckpointStore || sequenceNumber <= 1) {
      this.logger.debug(
        {
          handlerName,
          eventId: event.id,
          sequenceNumber,
          hasCheckpointStore: !!this.processorCheckpointStore,
        },
        "Skipping previous event check",
      );
      return true; // No previous event to check or no checkpoint store
    }

    const previousSequenceNumber = sequenceNumber - 1;

    this.logger.debug(
      {
        handlerName,
        eventId: event.id,
        sequenceNumber,
        previousSequenceNumber,
      },
      "Checking previous event",
    );

    // For early ordering check, we check once immediately (fail fast)
    // Retries are not needed here - if the previous event isn't processed, we should fail immediately
    // Retries are only needed later in the validation flow for eventual consistency in distributed stores
    const previousCheckpoint =
      await this.processorCheckpointStore.getCheckpointBySequenceNumber(
        this.checkpointManager.getPipelineName(),
        handlerName,
        "handler",
        event.tenantId,
        event.aggregateType,
        String(event.aggregateId),
        previousSequenceNumber,
      );

    this.logger.debug(
      {
        handlerName,
        eventId: event.id,
        previousSequenceNumber,
        found: previousCheckpoint !== null,
        checkpointSequence: previousCheckpoint?.sequenceNumber ?? null,
        checkpointStatus: previousCheckpoint?.status ?? null,
      },
      "Previous checkpoint lookup result",
    );

    return previousCheckpoint !== null;
  }

  /**
   * Handles a single event with a handler and updates checkpoint on success.
   * Implements per-event checkpointing with failure detection.
   * Uses shared validation and checkpointing logic via validateEventProcessing and saveCheckpointSafely.
   * Uses distributed locking (if configured) to serialize processing per aggregate.
   *
   * **Early Ordering Check:** Computes sequence number and checks previous event status
   * before acquiring lock to avoid unnecessary lock contention.
   */
  async handleEvent(
    handlerName: string,
    handlerDef: EventHandlerDefinition<EventType>,
    event: EventType,
    context: EventStoreReadContext<EventType>,
  ): Promise<void> {
    await this.tracer.withActiveSpan(
      "EventHandlerDispatcher.handleEvent",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "handler.name": handlerName,
          "event.id": event.id,
          "event.aggregate_id": String(event.aggregateId),
          "event.timestamp": event.timestamp,
          "event.type": event.type,
          "event.tenant_id": event.tenantId,
        },
      },
      async () => {
        // Compute sequence number FIRST (before lock acquisition) for early ordering check
        let sequenceNumber: number;
        try {
          sequenceNumber = await this.validator.computeEventSequenceNumber(
            event,
            context,
          );
          this.logger.debug(
            {
              handlerName,
              eventId: event.id,
              sequenceNumber,
            },
            "Computed sequence number",
          );
        } catch (error) {
          this.logger.error(
            {
              handlerName,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to compute sequence number for event",
          );
          throw error;
        }

        // Early ordering check: if previous event not processed, fail fast without acquiring lock
        // But if there are failures, we should skip gracefully (let validateEventProcessing handle it)
        // to allow the idempotency checker to save a pending checkpoint for optimistic locking
        const previousEventProcessed = await this.checkPreviousEventProcessed(
          handlerName,
          event,
          sequenceNumber,
        );

        this.logger.debug(
          {
            handlerName,
            eventId: event.id,
            sequenceNumber,
            previousEventProcessed,
          },
          "Previous event check result",
        );

        if (!previousEventProcessed) {
          // Check for failures before throwing - if there are failures, skip gracefully
          // This allows validateEventProcessing to save a pending checkpoint via idempotency checker
          const hasFailures = this.processorCheckpointStore
            ? await this.processorCheckpointStore.hasFailedEvents(
                this.checkpointManager.getPipelineName(),
                handlerName,
                "handler",
                event.tenantId,
                event.aggregateType,
                String(event.aggregateId),
              )
            : false;

          if (hasFailures) {
            this.logger.debug(
              {
                handlerName,
                eventId: event.id,
                sequenceNumber,
              },
              "Previous event not processed but failures exist - continuing to validateEventProcessing to save pending checkpoint",
            );
            // Continue to validateEventProcessing - it will check failures and return null,
            // but the idempotency checker will save a pending checkpoint first
            // We need to skip the ordering check in validateEventProcessing since we already know it will fail
            // But we want to let it save the pending checkpoint, so we'll pass skipOrderingCheck
            // Actually, validateEventProcessing checks failures first, so it will return null before checking ordering
            // So we can just continue and let it handle it
          } else {
            const previousSequenceNumber = sequenceNumber - 1;

            this.logger.debug(
              {
                handlerName,
                eventId: event.id,
                sequenceNumber,
                previousSequenceNumber,
              },
              "Throwing ordering error",
            );

            this.logger.warn(
              {
                handlerName,
                eventId: event.id,
                aggregateId: String(event.aggregateId),
                sequenceNumber,
                previousSequenceNumber,
                tenantId: event.tenantId,
              },
              "Previous event has not been processed yet. Processing stopped to maintain event ordering.",
            );
            throw new SequentialOrderingError(
              previousSequenceNumber,
              sequenceNumber,
              event.id,
              String(event.aggregateId),
              event.tenantId,
              {
                handlerName,
              },
            );
          }
        }

        // Calculate lock TTL based on sequence number
        const lockTtlMs = this.calculateLockTtl(
          sequenceNumber,
          this.handlerLockTtlMs,
        );

        // Acquire distributed lock if configured (only after confirming previous event is processed)
        // Lock key format: handler:${tenantId}:${aggregateType}:${aggregateId}:${handlerName}
        const lockKey = `handler:${event.tenantId}:${this.aggregateType}:${String(event.aggregateId)}:${handlerName}`;
        const lockHandle = this.distributedLock
          ? await this.distributedLock.acquire(lockKey, lockTtlMs)
          : null;

        if (this.distributedLock && !lockHandle) {
          throw new LockError(
            lockKey,
            "handleEvent",
            `Cannot acquire lock for handler: ${lockKey}. Another process is handling this event. Will retry.`,
            {
              handlerName,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
            },
          );
        }

        try {
          // Validate event processing prerequisites (idempotency, failures)
          // Note: ordering is already checked above in early check using the same method
          // (getCheckpointBySequenceNumber) that orderingValidator uses, so it's safe to skip here.
          // The lock acquisition above ensures no concurrent processing of the same aggregate.
          const validatedSequenceNumber =
            await this.validator.validateEventProcessing(
              handlerName,
              "handler",
              event,
              context,
              { skipOrderingCheck: true },
            );

          // If validation returned null, processing should be skipped (already processed or has failures)
          if (validatedSequenceNumber === null) {
            this.logger.debug(
              {
                handlerName,
                eventId: event.id,
                aggregateId: String(event.aggregateId),
                tenantId: event.tenantId,
              },
              "Skipping event processing - already processed or has failures",
            );
            return;
          }

          // Use the validated sequence number (should match computed sequence number)
          sequenceNumber = validatedSequenceNumber;

          this.logger.debug(
            {
              handlerName,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
              sequenceNumber,
            },
            "Starting event handler processing",
          );

          // Only save "pending" checkpoint if idempotency checker didn't already create one
          // The idempotency checker creates a "pending" checkpoint when claiming a new event
          // If a "pending" checkpoint already exists (from a retry), we don't need to save it again
          const checkpointKey = buildCheckpointKey(
            event.tenantId,
            this.checkpointManager.getPipelineName(),
            handlerName,
            event.aggregateType,
            String(event.aggregateId),
          );

          const existingCheckpoint =
            await this.processorCheckpointStore?.loadCheckpoint(checkpointKey);

          // Only save "pending" if:
          // 1. No checkpoint exists, OR
          // 2. Existing checkpoint has lower sequence number, OR
          // 3. Existing checkpoint is not "pending" for this sequence
          const needsPendingSave =
            !existingCheckpoint ||
            existingCheckpoint.sequenceNumber < sequenceNumber ||
            existingCheckpoint.status !== "pending" ||
            existingCheckpoint.sequenceNumber !== sequenceNumber;

          if (needsPendingSave) {
            this.logger.debug(
              {
                handlerName,
                eventId: event.id,
                aggregateId: String(event.aggregateId),
                sequenceNumber,
              },
              "Saving pending checkpoint before handler execution",
            );
            await this.checkpointManager.saveCheckpointSafely(
              handlerName,
              "handler",
              event,
              "pending",
              sequenceNumber,
            );
          } else {
            this.logger.debug(
              {
                handlerName,
                eventId: event.id,
                aggregateId: String(event.aggregateId),
                sequenceNumber,
              },
              "Pending checkpoint already exists for this sequence, skipping redundant save",
            );
          }

          // Process the event
          this.logger.debug(
            {
              handlerName,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
            },
            "Executing event handler",
          );
          await handlerDef.handler.handle(event);

          this.logger.debug(
            {
              handlerName,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
            },
            "Event handler executed successfully, saving processed checkpoint",
          );

          // Save checkpoint as "processed" on success
          // This is critical - if this fails, the checkpoint will remain "pending"
          // and subsequent events won't be able to process
          await this.checkpointManager.saveCheckpointSafely(
            handlerName,
            "handler",
            event,
            "processed",
            sequenceNumber,
          );

          this.logger.debug(
            {
              handlerName,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
              sequenceNumber,
            },
            "Event handler processing completed successfully",
          );
        } catch (error) {
          // Save checkpoint as "failed" on failure (only if we have a sequence number)
          const errorMessage =
            error instanceof Error ? error.message : String(error);

          if (sequenceNumber !== null) {
            this.logger.error(
              {
                handlerName,
                eventId: event.id,
                aggregateId: String(event.aggregateId),
                tenantId: event.tenantId,
                sequenceNumber,
                error: errorMessage,
                errorStack: error instanceof Error ? error.stack : void 0,
              },
              "Event handler execution failed, saving failed checkpoint",
            );

            await this.checkpointManager.saveCheckpointSafely(
              handlerName,
              "handler",
              event,
              "failed",
              sequenceNumber,
              errorMessage,
            );
          } else {
            this.logger.error(
              {
                handlerName,
                eventId: event.id,
                aggregateId: String(event.aggregateId),
                tenantId: event.tenantId,
                error: errorMessage,
                errorStack: error instanceof Error ? error.stack : void 0,
              },
              "Event handler validation or execution failed before sequence number was determined",
            );
          }

          this.logger.error(
            {
              handlerName,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
              tenantId: event.tenantId,
              error: errorMessage,
            },
            "Failed to handle event",
          );

          // Throw to stop queue processing
          throw error;
        } finally {
          // Always release lock, even on errors
          if (lockHandle) {
            try {
              await this.distributedLock!.release(lockHandle);
            } catch (error) {
              // Handler execution already completed; lock release failure is non-critical
              this.logger.error(
                {
                  handlerName,
                  eventId: event.id,
                  aggregateId: String(event.aggregateId),
                  tenantId: event.tenantId,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Failed to release distributed lock after handler execution",
              );
            }
          }
        }
      },
    );
  }

  /**
   * Gets the event types a handler is interested in.
   * Prefers options.eventTypes (explicit configuration) over handler.getEventTypes().
   * Returns undefined if handler should process all event types.
   */
  private getHandlerEventTypes(
    handlerDef: EventHandlerDefinition<EventType>,
  ): readonly EventType["type"][] | undefined {
    const { handler, options } = handlerDef;

    return options.eventTypes ?? handler.getEventTypes?.();
  }
}
