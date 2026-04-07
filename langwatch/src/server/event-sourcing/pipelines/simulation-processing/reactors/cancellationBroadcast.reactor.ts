import { createLogger } from "../../../../../utils/logger";
import type { CancellationPublisher } from "../../../../scenarios/cancellation-channel";
import { publishCancellation } from "../../../../scenarios/cancellation-channel";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationRunCancelRequestedEvent } from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:simulation-processing:cancellation-broadcast",
);

export interface CancellationBroadcastReactorDeps {
  publisher: CancellationPublisher | null;
}

/**
 * Reactor that broadcasts cancellation signals to all worker pods via Redis pub/sub.
 *
 * Fires only on cancel_requested events. Each worker pod checks if it owns the
 * scenario and kills its child process if so.
 */
export function createCancellationBroadcastReactor(
  deps: CancellationBroadcastReactorDeps,
): ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData> {
  return {
    name: "cancellationBroadcast",
    options: {
      runIn: ["web", "worker"],
    },

    async handle(
      event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      if (!isSimulationRunCancelRequestedEvent(event)) return;
      if (!deps.publisher) {
        logger.warn(
          { scenarioRunId: context.foldState.ScenarioRunId },
          "No Redis publisher available, cancellation broadcast skipped",
        );
        return;
      }

      try {
        await publishCancellation({
          publisher: deps.publisher,
          message: {
            scenarioRunId: context.foldState.ScenarioRunId,
            projectId: String(event.tenantId),
            batchRunId: context.foldState.BatchRunId,
          },
        });

        logger.debug(
          {
            scenarioRunId: context.foldState.ScenarioRunId,
            batchRunId: context.foldState.BatchRunId,
          },
          "Broadcasted cancellation signal",
        );
      } catch (error) {
        logger.error(
          {
            scenarioRunId: context.foldState.ScenarioRunId,
            batchRunId: context.foldState.BatchRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to broadcast cancellation signal",
        );
        throw error;
      }
    },
  };
}
