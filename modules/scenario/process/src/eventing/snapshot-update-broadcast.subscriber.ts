import type { SubscriberSpec } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import type { SimulationProcessingEvent } from "@langwatch/scenario-contract";

const logger = createLogger("langwatch:simulation-processing:snapshot-update-broadcast");

export interface SnapshotUpdateBroadcastSubscriberDeps {
  broadcastUpdate(input: { tenantId: string; payload: string }): Promise<void>;
}

/**
 * Broadcasts simulation updates to SSE clients (payload: ids + status from EVENT ECST).
 * Not fold-attached; delay absorbs lag. Frontend refetches on receipt. Failure swallowed.
 */
export function createSnapshotUpdateBroadcastSubscriber(
  deps: SnapshotUpdateBroadcastSubscriberDeps,
): SubscriberSpec<SimulationProcessingEvent> & {
  fold?: never;
  map?: never;
} {
  return {
    events: [
      SIMULATION_RUN_EVENT_TYPES.QUEUED,
      SIMULATION_RUN_EVENT_TYPES.STARTED,
      SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
      SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
      SIMULATION_RUN_EVENT_TYPES.FINISHED,
      SIMULATION_RUN_EVENT_TYPES.EVALUATED,
      SIMULATION_RUN_EVENT_TYPES.DELETED,
      SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED,
    ],
    delay: 2000, // Absorb fold-commit lag before the UI refetches
    dedupId: (event) => `sim-update:${event.tenantId}:${event.aggregateId}`,
    ttl: 1000, // Debounce broadcasts slightly

    async handler(event: SimulationProcessingEvent): Promise<void> {
      const tenantId = String(event.tenantId);
      const scenarioRunId = event.aggregateId;

      try {
        // TEXT_MESSAGE_START is excluded from `events` (the API route owns
        // streaming broadcasts), so every delivery here is a settled-state
        // nudge. Identity/status ride on the event when present: queued/started
        // carry the ids; finished carries them post-enrichment plus status.
        const data = event.data as {
          batchRunId?: string;
          scenarioSetId?: string;
          status?: string;
        };

        const payload = JSON.stringify({
          event: "simulation_updated",
          scenarioRunId,
          ...(data.batchRunId !== undefined && { batchRunId: data.batchRunId }),
          ...(data.scenarioSetId !== undefined && {
            scenarioSetId: data.scenarioSetId,
          }),
          ...(data.status !== undefined && { status: data.status }),
        });

        await deps.broadcastUpdate({ tenantId, payload });

        logger.debug(
          { tenantId, scenarioRunId, batchRunId: data.batchRunId },
          "Broadcasted simulation update",
        );
      } catch (error) {
        logger.warn(
          {
            tenantId,
            scenarioRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast simulation update — non-fatal",
        );
      }
    },
  };
}
