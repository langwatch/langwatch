import type { Event } from "../../domain/types";
import type { ProcessorCheckpointStore } from "../../stores/eventHandlerCheckpointStore.types";
import { createLogger } from "~/utils/logger";
import { buildCheckpointKey } from "../../utils/checkpointKey";

/**
 * Manages processor checkpoints with error handling.
 * Wraps checkpoint store operations with logging to ensure checkpoint errors
 * don't interrupt event processing.
 */
export class CheckpointManager<EventType extends Event = Event> {
  private readonly processorCheckpointStore?: ProcessorCheckpointStore;
  private readonly pipelineName: string;
  private readonly logger = createLogger(
    "langwatch:event-sourcing:checkpoint-manager",
  );

  constructor(
    pipelineName: string,
    processorCheckpointStore?: ProcessorCheckpointStore,
  ) {
    this.pipelineName = pipelineName;
    this.processorCheckpointStore = processorCheckpointStore;
  }

  /**
   * Gets the pipeline name.
   */
  getPipelineName(): string {
    return this.pipelineName;
  }

  /**
   * Saves checkpoint with error handling.
   *
   * Wraps checkpoint saving in try/catch to ensure checkpoint errors don't
   * interrupt event processing. Errors are logged but not thrown.
   *
   * @param processorName - Name of the processor (handler or projection)
   * @param processorType - Type of processor ("handler" or "projection")
   * @param event - Event being checkpointed
   * @param status - Checkpoint status (pending, processed, or failed)
   * @param sequenceNumber - Sequence number of the event
   * @param errorMessage - Optional error message for failed checkpoints
   */
  async saveCheckpointSafely(
    processorName: string,
    processorType: "handler" | "projection",
    event: EventType,
    status: "pending" | "processed" | "failed",
    sequenceNumber: number,
    errorMessage?: string,
  ): Promise<void> {
    if (!this.processorCheckpointStore) {
      this.logger.debug(
        {
          processorName,
          processorType,
          eventId: event.id,
          status,
        },
        "Skipping checkpoint save - no checkpoint store configured",
      );
      return;
    }

    try {
      // Construct checkpoint key: tenantId:pipelineName:processorName:aggregateType:aggregateId
      // This key represents the checkpoint for the entire aggregate, not a specific event
      const checkpointKey = buildCheckpointKey(
        event.tenantId,
        this.pipelineName,
        processorName,
        event.aggregateType,
        String(event.aggregateId),
      );

      // Safety check: Don't overwrite failed checkpoints unless we're explicitly saving a failed status
      // This prevents overwriting failed checkpoints with pending/processed statuses
      if (status !== "failed" && this.processorCheckpointStore) {
        const existingCheckpoint =
          await this.processorCheckpointStore.loadCheckpoint(checkpointKey);
        if (existingCheckpoint?.status === "failed") {
          this.logger.warn(
            {
              processorName,
              processorType,
              eventId: event.id,
              aggregateId: String(event.aggregateId),
              status,
              sequenceNumber,
              failedSequenceNumber: existingCheckpoint.sequenceNumber,
            },
            "Cannot save checkpoint - failed checkpoint exists. Failure detector should have caught this.",
          );
          // Don't overwrite failed checkpoint
          return;
        }
      }

      this.logger.debug(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
          status,
          sequenceNumber,
          checkpointKey,
        },
        `Saving checkpoint as ${status}`,
      );

      await this.processorCheckpointStore.saveCheckpoint(
        checkpointKey,
        processorType,
        event,
        status,
        sequenceNumber,
        errorMessage,
      );

      this.logger.debug(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
          status,
          sequenceNumber,
        },
        `Successfully saved checkpoint as ${status}`,
      );
    } catch (checkpointError) {
      const logMessage =
        status === "pending"
          ? `Failed to save pending checkpoint for ${processorType}`
          : status === "processed"
            ? `Failed to save checkpoint for ${processorType}`
            : `Failed to save failed checkpoint for ${processorType}`;

      this.logger.error(
        {
          processorName,
          processorType,
          eventId: event.id,
          aggregateId: String(event.aggregateId),
          status,
          sequenceNumber,
          error:
            checkpointError instanceof Error
              ? checkpointError.message
              : String(checkpointError),
          errorStack:
            checkpointError instanceof Error ? checkpointError.stack : void 0,
        },
        logMessage,
      );
    }
  }
}
