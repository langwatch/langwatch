import { createLogger } from "@langwatch/observability";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type { SubscriberSpec } from "../../../pipeline/processManagerDefinition";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:simulation-processing:snapshot-update-broadcast",
);

export interface SnapshotUpdateBroadcastSubscriberDeps {
  broadcast: BroadcastService;
  hasRedis?: boolean;
}

/**
 * Raw event subscriber that broadcasts simulation updates to connected SSE
 * clients. The payload is built from the EVENT (ECST) and carries only ids
 * plus status — the frontend refetches the run on receipt.
 *
 * Not fold-attached: `delay` absorbs fold-commit lag so the refetch almost
 * always sees settled state. The residual race (broadcast lands before the
 * fold writes, e.g. under queue backlog) is benign — the next event's
 * broadcast corrects it, and `finished` carries `status` in the payload
 * itself.
 *
 * Broadcast failure is swallowed — it must not block the pipeline.
 */
export function createSnapshotUpdateBroadcastSubscriber(
  deps: SnapshotUpdateBroadcastSubscriberDeps,
): SubscriberSpec<SimulationProcessingEvent> {
  return {
    events: [
      SIMULATION_RUN_EVENT_TYPES.QUEUED,
      SIMULATION_RUN_EVENT_TYPES.STARTED,
      SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
      SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
      SIMULATION_RUN_EVENT_TYPES.FINISHED,
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
        // nudge for the refetch path.
        //
        // Identity/status ride on the event when present: queued/started
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

        await deps.broadcast.broadcastToTenant(
          tenantId,
          payload,
          "simulation_updated",
        );

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
