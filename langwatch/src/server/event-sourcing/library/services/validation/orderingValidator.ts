import type { Event } from "../../domain/types";
import type { ProcessorCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";
import { createLogger } from "~/utils/logger";
import { SequentialOrderingError } from "../errorHandling";

/**
 * Validates that events are processed in sequential order.
 * Ensures event N can only be processed after event N-1 is processed.
 */
export class OrderingValidator<EventType extends Event = Event> {
  private readonly logger = createLogger(
    "langwatch:event-sourcing:ordering-validator",
  );

  constructor(
    private readonly processorCheckpointStore?: ProcessorCheckpointStore,
    private readonly pipelineName?: string,
  ) {}

  /**
   * Validates that the immediate predecessor (sequenceNumber - 1) has been processed.
   * If sequenceNumber is 1, there is no predecessor, so validation always passes.
   *
   * With per-aggregate checkpoints, we check if the aggregate's last processed
   * sequence number is >= the previous sequence number (N-1).
   *
   * @param processorName - Name of the processor (handler or projection)
   * @param processorType - Type of processor ("handler" or "projection")
   * @param event - The event being validated
   * @param sequenceNumber - The sequence number of the event
   * @throws {Error} If the immediate predecessor has not been processed
   */
  async validateOrdering(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    sequenceNumber: number,
  ): Promise<void> {
    if (!this.processorCheckpointStore || !this.pipelineName) {
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
      await this.processorCheckpointStore.getCheckpointBySequenceNumber(
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
          ? `${event.tenantId}:${this.pipelineName}:${processorName}:${event.aggregateType}:${String(event.aggregateId)}`
          : null,
      },
      "Previous checkpoint lookup result",
    );

    // If no processed checkpoint exists with sequence >= previousSequenceNumber, we must wait
    if (!previousCheckpoint) {
      // DEBUG: Try to find what checkpoints DO exist for this aggregate
      const checkpointKey = `${event.tenantId}:${this.pipelineName}:${processorName}:${event.aggregateType}:${String(event.aggregateId)}`;
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

  /**
   * Checks if the previous event (sequenceNumber - 1) has been processed.
   * Returns true if the previous event is processed, false otherwise.
   * This is a non-throwing version of validateOrdering for use in polling scenarios.
   *
   * Note: This method is part of the public API for external consumers who need to
   * check ordering status without triggering exceptions. It's useful for implementing
   * custom retry logic or polling-based ordering checks outside the standard queue flow.
   *
   * @param processorName - Name of the processor (handler or projection)
   * @param processorType - Type of processor ("handler" or "projection")
   * @param event - The event being checked
   * @param sequenceNumber - The sequence number of the event
   * @returns True if previous event is processed, false otherwise
   */
  async checkPreviousEventProcessed(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    sequenceNumber: number,
  ): Promise<boolean> {
    if (!this.processorCheckpointStore || !this.pipelineName) {
      return true; // No checkpoint store means no ordering enforcement, assume ready
    }

    // If sequenceNumber is 1, there's no predecessor to check
    if (sequenceNumber <= 1) {
      return true;
    }

    const previousSequenceNumber = sequenceNumber - 1;

    const previousCheckpoint =
      await this.processorCheckpointStore.getCheckpointBySequenceNumber(
        this.pipelineName,
        processorName,
        processorType,
        event.tenantId,
        event.aggregateType,
        String(event.aggregateId),
        previousSequenceNumber,
      );

    return previousCheckpoint !== null;
  }
}
