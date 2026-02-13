import { createLogger } from "~/utils/logger/server";
import type { AggregateType } from "../../domain/aggregateType";
import type { Event } from "../../domain/types";
import type { CheckpointStore } from "../../stores/checkpointStore.types";
import type {
  EventStore,
  EventStoreReadContext,
} from "../../stores/eventStore.types";
import { buildCheckpointKey } from "../../utils/checkpointKey";
import { SequentialOrderingError } from "../errorHandling";

/**
 * Orchestrates event processing validation by coordinating sequence number calculation,
 * idempotency checking, failure detection, and ordering validation.
 * Shared validation logic used by both handlers and projections.
 */
export class ProjectionValidator<EventType extends Event = Event> {
  private readonly eventStore: EventStore<EventType>;
  private readonly aggregateType: AggregateType;
  private readonly checkpointStore?: CheckpointStore;
  private readonly pipelineName: string;
  private readonly logger = createLogger(
    "langwatch:event-sourcing:event-processor-validator",
  );

  constructor({
    eventStore,
    aggregateType,
    checkpointStore,
    pipelineName,
  }: {
    eventStore: EventStore<EventType>;
    aggregateType: AggregateType;
    checkpointStore?: CheckpointStore;
    pipelineName: string;
  }) {
    this.eventStore = eventStore;
    this.aggregateType = aggregateType;
    this.checkpointStore = checkpointStore;
    this.pipelineName = pipelineName;
  }

  /**
   * Computes the sequence number for an event within its aggregate.
   * Sequence numbers are 1-indexed and represent the position of the event
   * in chronological order within the aggregate.
   *
   * @param event - The event to compute the sequence number for
   * @param context - Security context with required tenantId
   * @returns The sequence number (1-indexed)
   */
  async computeEventSequenceNumber(
    event: EventType,
    context: EventStoreReadContext<EventType>,
  ): Promise<number> {
    const count = await this.eventStore.countEventsBefore(
      String(event.aggregateId),
      context,
      this.aggregateType,
      event.timestamp,
      event.id,
    );

    const sequenceNumber = count + 1;

    this.logger.debug(
      {
        eventId: event.id,
        timestamp: event.timestamp,
        aggregateId: event.aggregateId,
        aggregateType: this.aggregateType,
        tenantId: context.tenantId,
        count,
        sequenceNumber,
      },
      "Computed sequence number for event",
    );

    return sequenceNumber;
  }

  /**
   * Computes the sequence number for an event from a pre-loaded events array.
   * Sequence numbers are 1-indexed and represent the position of the event
   * in chronological order within the aggregate.
   *
   * @param event - The event to compute the sequence number for
   * @param events - Pre-loaded events array for the aggregate (must be sorted chronologically)
   * @returns The sequence number (1-indexed)
   * @throws {Error} If the event is not found in the events array
   */
  computeSequenceNumberFromEvents(
    event: EventType,
    events: readonly EventType[],
  ): number {
    const index = events.findIndex((e) => e.id === event.id);
    if (index === -1) {
      throw new Error(
        `Event ${event.id} not found in events array for aggregate ${String(event.aggregateId)}`,
      );
    }
    const sequenceNumber = index + 1;

    this.logger.debug(
      {
        eventId: event.id,
        aggregateId: event.aggregateId,
        aggregateType: this.aggregateType,
        index,
        sequenceNumber,
      },
      "Computed sequence number from events array",
    );

    return sequenceNumber;
  }

  /**
   * Validates event processing prerequisites and returns sequence number.
   *
   * Performs shared validation logic for both handlers and projections:
   * - Sequence number computation
   * - Idempotency check (already processed) and atomic claim
   * - Failed events check (skips gracefully)
   * - Sequential ordering validation (throws on violations)
   *
   * @param processorName - Name of the processor (handler or projection)
   * @param processorType - Type of processor ("handler" or "projection")
   * @param event - Event to validate
   * @param context - Event store read context
   * @param options - Optional validation options
   * @param options.events - Pre-loaded events array. If provided, uses this to compute sequence number instead of querying the event store.
   * @returns Sequence number if validation passes, null if processing should be skipped (already processed or has failures)
   * @throws {Error} If sequential ordering is violated or sequence number computation fails
   */
  async validateEventProcessing(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    context: EventStoreReadContext<EventType>,
    options?: { events?: readonly EventType[]; sequenceNumber?: number },
  ): Promise<number | null> {
    // Compute sequence number for this event
    let sequenceNumber: number;
    try {
      if (options?.sequenceNumber !== undefined) {
        // Use pre-computed sequence number (avoids duplicate ClickHouse query)
        sequenceNumber = options.sequenceNumber;
      } else if (options?.events) {
        // Use pre-loaded events array to compute sequence number
        sequenceNumber = this.computeSequenceNumberFromEvents(
          event,
          options.events,
        );
      } else {
        // Fall back to querying the event store
        sequenceNumber = await this.computeEventSequenceNumber(event, context);
      }
    } catch (error) {
      this.logger.error(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to compute sequence number for event",
      );
      throw error;
    }

    // Check if any previous events failed (stop processing if so)
    // This check must happen BEFORE idempotency check to prevent overwriting failed checkpoints
    // and BEFORE ordering checks so it catches failures even when sequenceNumber is 1
    const hasFailures = await this.hasFailedEvents(
      processorName,
      processorType,
      event,
    );

    // Check if event already processed (idempotency) and atomically claim it
    // This happens even when there are failures to save a pending checkpoint for optimistic locking
    // but we still skip processing if there are failures
    const alreadyProcessed = await this.checkAndClaim(
      processorName,
      processorType,
      event,
      sequenceNumber,
    );
    if (alreadyProcessed) {
      return null;
    }

    if (hasFailures) {
      const errorMessage =
        "Previous events have failed processing for this aggregate. Processing stopped to prevent cascading failures.";
      this.logger.warn(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
          tenantId: event.tenantId,
        },
        errorMessage,
      );
      // Skip processing gracefully (don't throw)
      // This allows storeEvents to succeed even when processing is skipped
      // The pending checkpoint was already saved by idempotency checker above
      return null;
    }

    // Enforce ordering: check if the immediate predecessor has been processed
    await this.validateOrdering(
      processorName,
      processorType,
      event,
      sequenceNumber,
    );

    return sequenceNumber;
  }

  // ---------------------------------------------------------------------------
  // Private: Failure detection
  // ---------------------------------------------------------------------------

  /**
   * Checks if any previous events have failed processing for an aggregate.
   * If failures are detected, processing should be stopped to prevent cascading failures.
   */
  private async hasFailedEvents(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
  ): Promise<boolean> {
    if (!this.checkpointStore || !this.pipelineName) {
      return false;
    }

    return await this.checkpointStore.hasFailedEvents(
      this.pipelineName,
      processorName,
      processorType,
      event.tenantId,
      event.aggregateType,
      String(event.aggregateId),
    );
  }

  // ---------------------------------------------------------------------------
  // Private: Idempotency checking
  // ---------------------------------------------------------------------------

  /**
   * Checks if an event has already been processed and atomically claims it if not.
   * This prevents TOCTOU race conditions where multiple processes try to process the same event.
   *
   * @returns True if already processed or claimed by another process, false if successfully claimed
   */
  private async checkAndClaim(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    sequenceNumber: number,
  ): Promise<boolean> {
    if (!this.checkpointStore || !this.pipelineName) {
      return false;
    }

    // Build checkpoint key for the aggregate (not the event)
    const checkpointKey = buildCheckpointKey(
      event.tenantId,
      this.pipelineName,
      processorName,
      event.aggregateType,
      String(event.aggregateId),
    );
    const existingCheckpoint =
      await this.checkpointStore.loadCheckpoint(checkpointKey);

    // If checkpoint exists and is processed, check if this sequence number was already processed
    if (existingCheckpoint?.status === "processed") {
      // If the checkpoint's sequence number is >= current sequence number, it's already processed
      if (existingCheckpoint.sequenceNumber >= sequenceNumber) {
        this.logger.debug(
          {
            processorName,
            processorType,
            eventId: event.id,
            aggregateId: String(event.aggregateId),
            sequenceNumber,
            checkpointSequenceNumber: existingCheckpoint.sequenceNumber,
          },
          processorType === "handler"
            ? "Event already processed, skipping"
            : "Event already processed for projection, skipping",
        );
        return true; // Already processed
      }

      // If checkpoint has lower sequence number, allow processing (will update checkpoint)
    }

    // Don't overwrite failed checkpoints - failure detector should have caught this earlier
    // but we check here as a safety measure to prevent overwriting failed checkpoints
    if (existingCheckpoint?.status === "failed") {
      this.logger.warn(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
          sequenceNumber,
          failedSequenceNumber: existingCheckpoint.sequenceNumber,
        },
        "Cannot claim event - previous event failed. Failure detector should have caught this.",
      );
      return true; // Treat as already processed (blocked by failure)
    }

    // If checkpoint doesn't exist or has lower sequence number, atomically claim it by saving a pending checkpoint
    // This prevents TOCTOU race conditions where multiple processes try to process the same event
    // IMPORTANT: Don't save pending checkpoint if there's a processed checkpoint with lower sequence number,
    // as this would overwrite it and break ordering validation. The pending checkpoint will be saved
    // after ordering validation passes.
    if (
      !existingCheckpoint ||
      existingCheckpoint.sequenceNumber < sequenceNumber
    ) {
      // If there's a processed checkpoint with lower sequence number, don't overwrite it yet
      // Ordering validation needs to check it first. The pending checkpoint will be saved after validation.
      if (
        existingCheckpoint?.status === "processed" &&
        existingCheckpoint.sequenceNumber < sequenceNumber
      ) {
        // Don't save pending checkpoint here - let ordering validation check the previous checkpoint first
        // The pending checkpoint will be saved after ordering validation passes
        return false; // Not processed, allow processing to continue
      }

      // Re-check for failed checkpoint right before saving to prevent race conditions
      const recheckCheckpoint =
        await this.checkpointStore.loadCheckpoint(checkpointKey);
      if (recheckCheckpoint?.status === "failed") {
        this.logger.warn(
          {
            processorName,
            processorType,
            eventId: event.id,
            aggregateId: String(event.aggregateId),
            sequenceNumber,
            failedSequenceNumber: recheckCheckpoint.sequenceNumber,
          },
          "Cannot claim event - failed checkpoint detected during claim. Failure detector should have caught this.",
        );
        return true; // Treat as already processed (blocked by failure)
      }

      try {
        await this.checkpointStore.saveCheckpoint(
          event.tenantId,
          checkpointKey,
          processorType,
          event,
          "pending",
          sequenceNumber,
        );
        return false; // Successfully claimed
      } catch (error) {
        // If save fails, another process may have claimed it - check again
        const recheckCheckpoint =
          await this.checkpointStore.loadCheckpoint(checkpointKey);
        if (
          recheckCheckpoint?.status === "processed" &&
          recheckCheckpoint.sequenceNumber >= sequenceNumber
        ) {
          // Another process already processed it
          this.logger.debug(
            {
              processorName,
              processorType,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
              sequenceNumber,
            },
            processorType === "handler"
              ? "Event already processed by another process, skipping"
              : "Event already processed for projection by another process, skipping",
          );
          return true; // Already processed
        }

        // If still not processed, the error is unexpected - log and continue
        // The pending checkpoint will be saved again later in saveCheckpointSafely
        this.logger.warn(
          {
            processorName,
            processorType,
            eventId: event.id,
            aggregateId: String(event.aggregateId),
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to save pending checkpoint during validation, continuing anyway",
        );
        return false; // Claim failed but continue anyway
      }
    } else if (existingCheckpoint.status === "pending") {
      // A pending checkpoint exists - this could be from a previous failed attempt
      // (e.g., ordering validation failed). We'll allow processing to continue
      // and let ordering validation decide if it should proceed.
      // The pending checkpoint will be overwritten when processing completes.
      this.logger.debug(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
        },
        "Pending checkpoint exists from previous attempt, allowing processing to continue",
      );
      return false; // Allow processing - ordering validation will decide
    }

    return false; // Not processed, not claimed
  }

  // ---------------------------------------------------------------------------
  // Private: Ordering validation
  // ---------------------------------------------------------------------------

  /**
   * Validates that the immediate predecessor (sequenceNumber - 1) has been processed.
   * If sequenceNumber is 1, there is no predecessor, so validation always passes.
   *
   * @throws {SequentialOrderingError} If the immediate predecessor has not been processed
   */
  private async validateOrdering(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    sequenceNumber: number,
  ): Promise<void> {
    if (!this.checkpointStore || !this.pipelineName) {
      return; // No checkpoint store means no ordering enforcement
    }

    // If sequenceNumber is 1, there's no predecessor to check
    if (sequenceNumber <= 1) {
      this.logger.debug(
        {
          eventId: event.id,
          sequenceNumber,
          processorName,
          processorType,
          reason: "sequenceNumber <= 1, no predecessor to check",
        },
        "Skipping ordering validation - first event",
      );
      return;
    }

    const previousSequenceNumber = sequenceNumber - 1;

    this.logger.debug(
      {
        eventId: event.id,
        sequenceNumber,
        previousSequenceNumber,
        processorName,
        processorType,
        aggregateId: String(event.aggregateId),
        tenantId: event.tenantId,
        pipelineName: this.pipelineName,
      },
      "Checking if previous event processed",
    );

    // Use getCheckpointBySequenceNumber to check if previousSequenceNumber was processed
    // This method loads the aggregate checkpoint and verifies it's processed with sequence >= previousSequenceNumber
    const previousCheckpoint =
      await this.checkpointStore.getCheckpointBySequenceNumber(
        this.pipelineName,
        processorName,
        processorType,
        event.tenantId,
        event.aggregateType,
        String(event.aggregateId),
        previousSequenceNumber,
      );

    this.logger.debug(
      {
        eventId: event.id,
        previousSequenceNumber,
        found: previousCheckpoint !== null,
        checkpointSequence: previousCheckpoint?.sequenceNumber ?? null,
        checkpointStatus: previousCheckpoint?.status ?? null,
        checkpointEventId: previousCheckpoint?.eventId ?? null,
        checkpointKey: previousCheckpoint
          ? buildCheckpointKey(event.tenantId, this.pipelineName, processorName, event.aggregateType, String(event.aggregateId))
          : null,
      },
      "Previous checkpoint lookup result",
    );

    // If no processed checkpoint exists with sequence >= previousSequenceNumber, we must wait
    if (!previousCheckpoint) {
      // DEBUG: Try to find what checkpoints DO exist for this aggregate
      const checkpointKey = buildCheckpointKey(event.tenantId, this.pipelineName, processorName, event.aggregateType, String(event.aggregateId));
      this.logger.warn(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
          sequenceNumber,
          previousSequenceNumber,
          tenantId: event.tenantId,
          checkpointKey,
          reason: "No checkpoint found for previous sequence number",
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
          processorName,
          processorType,
        },
      );
    }
  }
}
