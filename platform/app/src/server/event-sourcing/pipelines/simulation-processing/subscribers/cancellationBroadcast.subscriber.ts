import type { TriggerContext } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import type { CancellationPublisher } from "../../../../scenarios/cancellation-channel";
import { publishCancellation } from "../../../../scenarios/cancellation-channel";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:simulation-processing:cancellation-broadcast",
);

export interface CancellationBroadcastSubscriberDeps {
  publisher: CancellationPublisher | null;
}

/**
 * Subscriber handler that broadcasts cancellation signals to all worker pods
 * via Redis pub/sub.
 *
 * Registered for cancel_requested events only. Each worker pod checks if it
 * owns the scenario and kills its child process if so.
 */
export function createCancellationBroadcastHandler(
  deps: CancellationBroadcastSubscriberDeps,
): (
  event: SimulationProcessingEvent,
  context: TriggerContext<SimulationRunStateData>,
) => Promise<void> {
  return async (event, context) => {
    const foldState = context.state;
    if (!deps.publisher) {
      logger.warn(
        { scenarioRunId: foldState.ScenarioRunId },
        "No Redis publisher available, cancellation broadcast skipped",
      );
      return;
    }

    try {
      await publishCancellation({
        publisher: deps.publisher,
        message: {
          scenarioRunId: foldState.ScenarioRunId,
          projectId: String(event.tenantId),
          batchRunId: foldState.BatchRunId,
        },
      });

      logger.debug(
        {
          scenarioRunId: foldState.ScenarioRunId,
          batchRunId: foldState.BatchRunId,
        },
        "Broadcasted cancellation signal",
      );
    } catch (error) {
      logger.error(
        {
          scenarioRunId: foldState.ScenarioRunId,
          batchRunId: foldState.BatchRunId,
          error: error instanceof Error ? error.message : String(error),
        },
        "Failed to broadcast cancellation signal",
      );
      throw error;
    }
  };
}
