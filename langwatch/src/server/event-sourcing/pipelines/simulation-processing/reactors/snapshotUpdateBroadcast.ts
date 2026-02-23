import { createLogger } from "../../../../../utils/logger/server";
import type { BroadcastService } from "../../../../app-layer/broadcast/broadcast.service";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";

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
      _event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      try {
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
