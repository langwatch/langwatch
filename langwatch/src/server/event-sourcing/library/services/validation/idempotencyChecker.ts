import { createLogger } from "~/utils/logger";
import type { Event } from "../../domain/types";
import type { ProcessorCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";
import { buildCheckpointKey } from "../../utils/checkpointKey";

/**
 * Checks if events have already been processed (idempotency) and atomically claims events
 * to prevent TOCTOU race conditions.
 */
export class IdempotencyChecker<EventType extends Event = Event> {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:idempotency-checker",
  );

  constructor(
    private readonly processorCheckpointStore?: ProcessorCheckpointStore,
    private readonly pipelineName?: string,
  ) {}

  /**
   * Checks if an event has already been processed and atomically claims it if not.
   * This prevents TOCTOU race conditions where multiple processes try to process the same event.
   *
   * @param processorName - Name of the processor (handler, projection, or something more specific)
   * @param processorType - Type of processor ("handler" or "projection")
   * @param event - The event to check
   * @param sequenceNumber - The sequence number of the event (used when claiming)
   * @returns True if already processed or claimed by another process, false if successfully claimed
   */
  async checkAndClaim(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    sequenceNumber: number,
  ): Promise<boolean> {
    if (!this.processorCheckpointStore || !this.pipelineName) {
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
      await this.processorCheckpointStore.loadCheckpoint(checkpointKey);

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
        await this.processorCheckpointStore.loadCheckpoint(checkpointKey);
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
        await this.processorCheckpointStore.saveCheckpoint(
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
          await this.processorCheckpointStore.loadCheckpoint(checkpointKey);
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
        // The pending checkpoint will be saved again later in CheckpointManager
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
}
