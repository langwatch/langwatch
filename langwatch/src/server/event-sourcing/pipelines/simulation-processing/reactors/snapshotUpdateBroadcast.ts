import { createLogger } from "../../../../../utils/logger/server";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationTextMessageStartEvent } from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:simulation-processing:snapshot-update-broadcast",
);

export interface SnapshotUpdateBroadcastReactorDeps {
  broadcast: BroadcastService;
  hasRedis?: boolean;
}

/**
 * Reactor that broadcasts simulation updates to connected SSE clients.
 *
 * Fires on ALL event types (started, snapshot, finished, deleted).
 * The frontend debounces duplicate events.
 * Broadcast failure is swallowed — it must not block the pipeline.
 */
export function createSnapshotUpdateBroadcastReactor(
  deps: SnapshotUpdateBroadcastReactorDeps,
): ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData> {
  return {
    name: "snapshotUpdateBroadcast",
    options: {
      runIn: ["web", "worker"],
      makeJobId: (payload) =>
        `sim-update:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 1000, // Debounce broadcasts slightly
    },

    async handle(
      event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      try {
        // START/END streaming broadcasts are handled directly by the API
        // route (broadcastStreamingEvent in app.ts) — the reactor only
        // emits the generic "simulation_updated" so the refetch path picks
        // up settled state once the fold projection has been written.
        //
        // Skip simulation_updated for START events to avoid a premature
        // refetch that would replace accumulated streaming content with
        // the empty fold-projection row.
        if (isSimulationTextMessageStartEvent(event)) {
          logger.debug(
            { tenantId, scenarioRunId: foldState.ScenarioRunId },
            "Skipped reactor broadcast for text_message_start (API route handles streaming)",
          );
          return;
        }

        const payload = JSON.stringify({
          event: "simulation_updated",
          scenarioRunId: foldState.ScenarioRunId,
          batchRunId: foldState.BatchRunId,
          scenarioSetId: foldState.ScenarioSetId,
          status: foldState.Status,
        });

        await deps.broadcast.broadcastToTenant(
          tenantId,
          payload,
          "simulation_updated",
        );

        logger.debug(
          {
            tenantId,
            scenarioRunId: foldState.ScenarioRunId,
            batchRunId: foldState.BatchRunId,
          },
          "Broadcasted simulation update",
        );
      } catch (error) {
        logger.warn(
          {
            tenantId,
            scenarioRunId: foldState.ScenarioRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast simulation update — non-fatal",
        );
      }
    },
  };
}
