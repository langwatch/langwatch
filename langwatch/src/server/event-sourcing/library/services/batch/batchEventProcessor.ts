import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import { EventUtils } from "../../index";
import type { ProcessorCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";
import type {
  EventStore,
  EventStoreReadContext,
} from "../../stores/eventStore.types";
import type { DistributedLock, LockHandle } from "../../utils/distributedLock";
import { LockError } from "../errorHandling";

/**
 * Result of batch event processing.
 */
export interface BatchProcessingResult {
  /** Number of events successfully processed */
  processedCount: number;
  /** Total number of unprocessed events found */
  totalUnprocessedCount: number;
  /** Whether all events were processed successfully */
  success: boolean;
  /** Error if processing failed (only set when success is false) */
  error?: Error;
  /** Sequence number of the last successfully processed event */
  lastProcessedSequence: number;
}

/**
 * Context for batch event processing.
 */
export interface BatchProcessingContext<EventType extends Event = Event> {
  /** Tenant ID for the aggregate */
  tenantId: EventType["tenantId"];
  /** Aggregate type */
  aggregateType: AggregateType;
  /** Aggregate ID */
  aggregateId: string;
}

/**
 * Callback function to process a single event.
 * Called by BatchEventProcessor for each unprocessed event in sequence.
 *
 * @param event - The event to process
 * @param sequenceNumber - The sequence number of the event (1-indexed)
 * @param context - Event store read context
 * @returns Promise that resolves when processing is complete
 * @throws Error if processing fails (will stop batch and trigger retry)
 */
export type SingleEventProcessor<EventType extends Event = Event> = (
  event: EventType,
  sequenceNumber: number,
  context: EventStoreReadContext<EventType>,
) => Promise<void>;

/**
 * Options for batch event processing.
 */
export interface BatchProcessingOptions {
  /** Lock TTL in milliseconds */
  lockTtlMs?: number;
  /** Whether to skip failure detection (useful for recovery scenarios) */
  skipFailureDetection?: boolean;
}

/**
 * Processes events in batches, resolving all unprocessed events from the event store.
 *
 * This service solves the BullMQ deduplication issue where earlier events get discarded
 * when multiple events arrive close together. Instead of processing the single event
 * from the queue payload, we:
 *
 * 1. Treat the queue job as a "trigger" (extract aggregate context only)
 * 2. Query checkpoint store for last processed sequence number
 * 3. Fetch ALL events for the aggregate from event store
 * 4. Filter to unprocessed events (sequence > last_processed)
 * 5. Process each sequentially, checkpointing as we go
 * 6. If any event fails, throw to trigger BullMQ retry
 *
 * @example
 * ```typescript
 * const batchProcessor = new BatchEventProcessor({
 *   eventStore,
 *   processorCheckpointStore,
 *   distributedLock,
 *   pipelineName: "trace-processing",
 *   aggregateType: "trace",
 * });
 *
 * // In queue processor callback:
 * await batchProcessor.processUnprocessedEvents(
 *   triggerEvent,
 *   "myHandler",
 *   "handler",
 *   async (event, sequenceNumber, context) => {
 *     // Process single event
 *     await myHandler.handle(event);
 *     // Checkpoint is saved by the processor after this returns
 *   },
 * );
 * ```
 */
export class BatchEventProcessor<EventType extends Event = Event> {
  private readonly tracer = getLangWatchTracer(
    "langwatch.event-sourcing.batch-event-processor",
  );
  private readonly logger = createLogger(
    "langwatch:event-sourcing:batch-event-processor",
  );

  constructor(
    private readonly eventStore: EventStore<EventType>,
    private readonly processorCheckpointStore:
      | ProcessorCheckpointStore
      | undefined,
    private readonly distributedLock: DistributedLock,
    private readonly pipelineName: string,
    private readonly aggregateType: AggregateType,
  ) {}

  /**
   * Processes all unprocessed events for an aggregate, triggered by an incoming event.
   *
   * The trigger event identifies the aggregate and serves as the upper bound for event fetching.
   * Events up to and including the trigger event are fetched and unprocessed ones are processed sequentially.
   *
   * @param triggerEvent - The event that triggered processing (used for aggregate identification and as upper bound for fetching)
   * @param processorName - Name of the processor (handler or projection)
   * @param processorType - Type of processor ("handler" or "projection")
   * @param processEvent - Callback to process a single event
   * @param options - Optional processing options
   * @returns Result of batch processing
   * @throws {LockError} If lock cannot be acquired
   * @throws {Error} If processing fails (after partial success, will have checkpointed progress)
   */
  async processUnprocessedEvents(
    triggerEvent: EventType,
    processorName: string,
    processorType: "handler" | "projection",
    processEvent: SingleEventProcessor<EventType>,
    options?: BatchProcessingOptions,
  ): Promise<BatchProcessingResult> {
    const context: BatchProcessingContext<EventType> = {
      tenantId: triggerEvent.tenantId,
      aggregateType: triggerEvent.aggregateType,
      aggregateId: String(triggerEvent.aggregateId),
    };

    // Validate tenant ID at entry point for security
    EventUtils.validateTenantId(
      { tenantId: context.tenantId },
      "BatchEventProcessor.processUnprocessedEvents",
    );

    return await this.tracer.withActiveSpan(
      "BatchEventProcessor.processUnprocessedEvents",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "processor.name": processorName,
          "processor.type": processorType,
          "aggregate.type": context.aggregateType,
          "aggregate.id": context.aggregateId,
          "tenant.id": String(context.tenantId),
          "trigger.event.id": triggerEvent.id,
        },
      },
      async (span) => {
        // Acquire distributed lock for the entire batch
        const lockKey = this.buildLockKey(processorName, context);
        const lockTtlMs = options?.lockTtlMs ?? 60000; // Default 60s for batch

        const lockHandle = await this.distributedLock.acquire(
          lockKey,
          lockTtlMs,
        );

        if (!lockHandle) {
          throw new LockError(
            lockKey,
            "processUnprocessedEvents",
            `Cannot acquire lock for batch processing: ${lockKey}. Another process is handling this aggregate.`,
            {
              processorName,
              processorType,
              aggregateId: context.aggregateId,
              tenantId: String(context.tenantId),
            },
          );
        }

        try {
          const eventStoreContext: EventStoreReadContext<EventType> = {
            tenantId: context.tenantId,
          };

          // Check for failed events (unless skipped)
          if (!options?.skipFailureDetection && this.processorCheckpointStore) {
            const hasFailures =
              await this.processorCheckpointStore.hasFailedEvents(
                this.pipelineName,
                processorName,
                processorType,
                context.tenantId,
                context.aggregateType,
                context.aggregateId,
              );

            if (hasFailures) {
              this.logger.warn(
                {
                  processorName,
                  processorType,
                  aggregateId: context.aggregateId,
                  tenantId: String(context.tenantId),
                },
                "Skipping batch processing - previous events have failed for this aggregate",
              );

              span.addEvent("batch.skipped.failures");
              return {
                processedCount: 0,
                totalUnprocessedCount: 0,
                success: false,
                lastProcessedSequence: 0,
                error: new Error(
                  "Previous events have failed processing for this aggregate",
                ),
              };
            }
          }

          // Get last processed sequence number
          const lastProcessedSequence = await this.getLastProcessedSequence(
            processorName,
            processorType,
            context,
          );

          span.setAttribute(
            "batch.last_processed_sequence",
            lastProcessedSequence,
          );

          this.logger.debug(
            {
              processorName,
              processorType,
              aggregateId: context.aggregateId,
              lastProcessedSequence,
            },
            "Fetching events for batch processing",
          );

          // Fetch ALL events for the aggregate
          // We use getEvents() instead of getEventsUpTo() because the trigger event may have
          // an earlier timestamp than other events that arrived concurrently. Using the trigger
          // event as an upper bound would miss those later events.
          // The batch processor filters by checkpoint sequence anyway, so fetching all events
          // is correct (though slightly less efficient).
          const allEvents = await this.eventStore.getEvents(
            context.aggregateId,
            eventStoreContext,
            this.aggregateType,
          );

          span.setAttribute("batch.total_events", allEvents.length);

          if (allEvents.length === 0) {
            this.logger.debug(
              {
                processorName,
                processorType,
                aggregateId: context.aggregateId,
              },
              "No events found for aggregate",
            );

            return {
              processedCount: 0,
              totalUnprocessedCount: 0,
              success: true,
              lastProcessedSequence,
            };
          }

          // Sort events by timestamp (and ID for tie-breaking)
          const sortedEvents = this.sortEventsByTimestamp(allEvents);

          // Filter to unprocessed events (sequence > lastProcessedSequence)
          // Sequence numbers are 1-indexed, so event at index 0 has sequence 1
          const unprocessedEvents = sortedEvents.filter(
            (_, index) => index + 1 > lastProcessedSequence,
          );

          span.setAttribute(
            "batch.unprocessed_count",
            unprocessedEvents.length,
          );

          this.logger.info(
            {
              processorName,
              processorType,
              aggregateId: context.aggregateId,
              totalEvents: allEvents.length,
              unprocessedCount: unprocessedEvents.length,
              lastProcessedSequence,
            },
            "Starting batch processing",
          );

          if (unprocessedEvents.length === 0) {
            this.logger.debug(
              {
                processorName,
                processorType,
                aggregateId: context.aggregateId,
              },
              "All events already processed",
            );

            return {
              processedCount: 0,
              totalUnprocessedCount: 0,
              success: true,
              lastProcessedSequence,
            };
          }

          // Process each unprocessed event sequentially
          let processedCount = 0;
          let currentSequence = lastProcessedSequence;

          for (const event of unprocessedEvents) {
            const sequenceNumber = lastProcessedSequence + processedCount + 1;

            try {
              span.addEvent("batch.event.start", {
                "event.id": event.id,
                "event.sequence": sequenceNumber,
              });

              this.logger.debug(
                {
                  processorName,
                  processorType,
                  eventId: event.id,
                  sequenceNumber,
                  aggregateId: context.aggregateId,
                },
                "Processing event in batch",
              );

              await processEvent(event, sequenceNumber, eventStoreContext);

              processedCount++;
              currentSequence = sequenceNumber;

              span.addEvent("batch.event.complete", {
                "event.id": event.id,
                "event.sequence": sequenceNumber,
              });

              this.logger.debug(
                {
                  processorName,
                  processorType,
                  eventId: event.id,
                  sequenceNumber,
                  aggregateId: context.aggregateId,
                },
                "Event processed successfully",
              );
            } catch (error) {
              span.addEvent("batch.event.error", {
                "event.id": event.id,
                "event.sequence": sequenceNumber,
                "error.message":
                  error instanceof Error ? error.message : String(error),
              });

              this.logger.error(
                {
                  processorName,
                  processorType,
                  eventId: event.id,
                  sequenceNumber,
                  aggregateId: context.aggregateId,
                  processedCount,
                  error: error instanceof Error ? error.message : String(error),
                },
                "Event processing failed in batch",
              );

              // Throw the original error so BullMQ can retry
              throw error;
            }
          }

          this.logger.info(
            {
              processorName,
              processorType,
              aggregateId: context.aggregateId,
              processedCount,
              totalUnprocessedCount: unprocessedEvents.length,
              lastProcessedSequence: currentSequence,
            },
            "Batch processing completed successfully",
          );

          return {
            processedCount,
            totalUnprocessedCount: unprocessedEvents.length,
            success: true,
            lastProcessedSequence: currentSequence,
          };
        } finally {
          await this.releaseLock(lockHandle, processorName, context);
        }
      },
    );
  }

  /**
   * Gets the last processed sequence number for a processor and aggregate.
   */
  private async getLastProcessedSequence(
    processorName: string,
    processorType: "handler" | "projection",
    context: BatchProcessingContext<EventType>,
  ): Promise<number> {
    if (!this.processorCheckpointStore) {
      return 0; // No checkpoint store means start from beginning
    }

    const checkpoint =
      await this.processorCheckpointStore.getLastProcessedEvent(
        this.pipelineName,
        processorName,
        processorType,
        context.tenantId,
        context.aggregateType,
        context.aggregateId,
      );

    if (!checkpoint || checkpoint.status !== "processed") {
      return 0;
    }

    return checkpoint.sequenceNumber;
  }

  /**
   * Sorts events by timestamp, using event ID for tie-breaking.
   */
  private sortEventsByTimestamp(
    events: readonly EventType[],
  ): readonly EventType[] {
    return [...events].sort((a, b) => {
      const timestampDiff = a.timestamp - b.timestamp;
      if (timestampDiff !== 0) {
        return timestampDiff;
      }
      // Tie-break by event ID for deterministic ordering
      return a.id.localeCompare(b.id);
    });
  }

  /**
   * Builds the lock key for batch processing.
   */
  private buildLockKey(
    processorName: string,
    context: BatchProcessingContext<EventType>,
  ): string {
    return `batch:${String(context.tenantId)}:${context.aggregateType}:${context.aggregateId}:${processorName}`;
  }

  /**
   * Releases the distributed lock with error handling.
   */
  private async releaseLock(
    lockHandle: LockHandle,
    processorName: string,
    context: BatchProcessingContext<EventType>,
  ): Promise<void> {
    try {
      await this.distributedLock.release(lockHandle);
    } catch (error) {
      // Lock release failure is non-critical - processing already completed
      this.logger.error(
        {
          processorName,
          aggregateId: context.aggregateId,
          tenantId: String(context.tenantId),
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to release distributed lock after batch processing",
      );
    }
  }
}
