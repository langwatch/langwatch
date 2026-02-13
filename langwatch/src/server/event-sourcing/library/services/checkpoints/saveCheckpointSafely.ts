import { createLogger } from "~/utils/logger/server";
import type { Event } from "../../domain/types";
import type { CheckpointStore } from "../../stores/checkpointStore.types";
import { buildCheckpointKey } from "../../utils/checkpointKey";

const logger = createLogger("langwatch:event-sourcing:checkpoint-manager");

/**
 * Saves checkpoint with error handling.
 *
 * Wraps checkpoint saving in try/catch to ensure checkpoint errors don't
 * interrupt event processing. Errors are logged but not thrown.
 */
export async function saveCheckpointSafely<EventType extends Event = Event>({
  checkpointStore,
  pipelineName,
  componentName,
  componentType,
  event,
  status,
  sequenceNumber,
  errorMessage,
}: {
  checkpointStore?: CheckpointStore;
  pipelineName: string;
  componentName: string;
  componentType: "handler" | "projection";
  event: EventType;
  status: "pending" | "processed" | "failed";
  sequenceNumber: number;
  errorMessage?: string;
}): Promise<void> {
  if (!checkpointStore) {
    logger.debug(
      {
        componentName,
        componentType,
        eventId: event.id,
        status,
      },
      "Skipping checkpoint save - no checkpoint store configured",
    );
    return;
  }

  try {
    // Construct checkpoint key: tenantId:pipelineName:componentName:aggregateType:aggregateId
    // This key represents the checkpoint for the entire aggregate, not a specific event
    const checkpointKey = buildCheckpointKey(
      event.tenantId,
      pipelineName,
      componentName,
      event.aggregateType,
      String(event.aggregateId),
    );

    // Note: We skip the failed checkpoint check here because:
    // 1. FailureDetector.hasFailedEvents() already checked for failed events before processing
    // 2. IdempotencyChecker.checkAndClaim() already checked for failed checkpoints and loaded the checkpoint
    // 3. By the time we reach saveCheckpointSafely, validation has already ensured no failed checkpoints exist
    // This eliminates redundant checkpoint loads (2 per event: pending + processed)

    logger.debug(
      {
        componentName,
        componentType,
        eventId: event.id,
        aggregateId: String(event.aggregateId),
        status,
        sequenceNumber,
        checkpointKey,
      },
      `Saving checkpoint as ${status}`,
    );

    await checkpointStore.saveCheckpoint(
      event.tenantId,
      checkpointKey,
      componentType,
      event,
      status,
      sequenceNumber,
      errorMessage,
    );

    logger.debug(
      {
        componentName,
        componentType,
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
        ? `Failed to save pending checkpoint for ${componentType}`
        : status === "processed"
          ? `Failed to save checkpoint for ${componentType}`
          : `Failed to save failed checkpoint for ${componentType}`;

    logger.error(
      {
        componentName,
        componentType,
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
