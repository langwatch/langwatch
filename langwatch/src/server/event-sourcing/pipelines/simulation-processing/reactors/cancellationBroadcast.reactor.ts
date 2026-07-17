import { createLogger } from "@langwatch/observability";
import type { CancellationPublisher } from "../../../../scenarios/cancellation-channel";
import { publishCancellation } from "../../../../scenarios/cancellation-channel";
import type {
  SubscriberSpec,
  TriggerContext,
} from "../../../pipeline/processManagerDefinition";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:simulation-processing:cancellation-broadcast",
);

export interface CancellationBroadcastSubscriberDeps {
  publisher: CancellationPublisher | null;
}

/**
 * Subscriber that broadcasts cancellation signals to all worker pods via
 * Redis pub/sub.
 *
 * Fires only on cancel_requested events. Each worker pod checks if it owns
 * the scenario and kills its child process if so.
 */
export function createCancellationBroadcastSubscriber(
  deps: CancellationBroadcastSubscriberDeps,
): { name: string; spec: SubscriberSpec<SimulationProcessingEvent> } {
  return {
    name: "cancellationBroadcast",
    spec: {
      fold: "simulationRunState",
      events: [SIMULATION_RUN_EVENT_TYPES.CANCEL_REQUESTED],

      handler: async (
        event: SimulationProcessingEvent,
        context: TriggerContext<SimulationRunStateData>,
      ): Promise<void> => {
        if (!deps.publisher) {
          logger.warn(
            { scenarioRunId: context.state.ScenarioRunId },
            "No Redis publisher available, cancellation broadcast skipped",
          );
          return;
        }

        try {
          await publishCancellation({
            publisher: deps.publisher,
            message: {
              scenarioRunId: context.state.ScenarioRunId,
              projectId: String(event.tenantId),
              batchRunId: context.state.BatchRunId,
            },
          });

          logger.debug(
            {
              scenarioRunId: context.state.ScenarioRunId,
              batchRunId: context.state.BatchRunId,
            },
            "Broadcasted cancellation signal",
          );
        } catch (error) {
          logger.error(
            {
              scenarioRunId: context.state.ScenarioRunId,
              batchRunId: context.state.BatchRunId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to broadcast cancellation signal",
          );
          throw error;
        }
      },
    },
  };
}
