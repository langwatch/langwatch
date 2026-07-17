import { createLogger } from "@langwatch/observability";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type {
  SubscriberSpec,
  TriggerContext,
} from "../../../pipeline/processManagerDefinition";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationTextMessageStartEvent } from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:simulation-processing:snapshot-update-broadcast",
);

export interface SnapshotUpdateBroadcastSubscriberDeps {
  broadcast: BroadcastService;
}

/**
 * Subscriber that broadcasts simulation updates to connected SSE clients.
 *
 * Fires on ALL event types (started, snapshot, finished, deleted) except
 * text_message_start — START/END streaming broadcasts are handled directly
 * by the API route (broadcastStreamingEvent in app.ts); the subscriber only
 * emits the generic "simulation_updated" so the refetch path picks up
 * settled state once the fold projection has been written. Skipping START
 * avoids a premature refetch that would replace accumulated streaming
 * content with the empty fold-projection row.
 *
 * The frontend debounces duplicate events.
 * Broadcast failure is swallowed — it must not block the pipeline.
 */
export function createSnapshotUpdateBroadcastSubscriber(
  deps: SnapshotUpdateBroadcastSubscriberDeps,
): { name: string; spec: SubscriberSpec<SimulationProcessingEvent> } {
  return {
    name: "snapshotUpdateBroadcast",
    spec: {
      fold: "simulationRunState",
      ttl: 1000, // Debounce broadcasts slightly
      when: (event) => !isSimulationTextMessageStartEvent(event),

      handler: async (
        _event: SimulationProcessingEvent,
        context: TriggerContext<SimulationRunStateData>,
      ): Promise<void> => {
        const { tenantId, state } = context;

        try {
          const payload = JSON.stringify({
            event: "simulation_updated",
            scenarioRunId: state.ScenarioRunId,
            batchRunId: state.BatchRunId,
            scenarioSetId: state.ScenarioSetId,
            status: state.Status,
          });

          await deps.broadcast.broadcastToTenant(
            tenantId,
            payload,
            "simulation_updated",
          );

          logger.debug(
            {
              tenantId,
              scenarioRunId: state.ScenarioRunId,
              batchRunId: state.BatchRunId,
            },
            "Broadcasted simulation update",
          );
        } catch (error) {
          logger.warn(
            {
              tenantId,
              scenarioRunId: state.ScenarioRunId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to broadcast simulation update — non-fatal",
          );
        }
      },
    },
  };
}
