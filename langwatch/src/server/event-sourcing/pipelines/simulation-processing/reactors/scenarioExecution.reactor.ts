/**
 * Scenario execution reactor — bridges ES events to the dedicated execution queue.
 *
 * Fires on SimulationRunQueuedEvent only, dispatches a job to the
 * ScenarioExecutionQueue. Does NOT execute inline.
 */

import { createLogger } from "../../../../../utils/logger/server";
import type { EventSourcedQueueProcessor } from "../../../queues";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationRunQueuedEvent } from "../schemas/typeGuards";
import type { ScenarioExecutionPayload } from "../../../../scenarios/execution/scenario-execution.queue";

const logger = createLogger(
  "langwatch:simulation-processing:scenario-execution-reactor",
);

export interface ScenarioExecutionReactorDeps {
  executionQueue: EventSourcedQueueProcessor<ScenarioExecutionPayload>;
}

/**
 * Creates a reactor that dispatches scenario execution jobs when runs are queued.
 */
export function createScenarioExecutionReactor(
  deps: ScenarioExecutionReactorDeps,
): ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData> {
  return {
    name: "scenarioExecution",
    options: {
      runIn: ["worker"],
    },

    async handle(
      event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      if (!isSimulationRunQueuedEvent(event)) {
        return;
      }

      const { tenantId, foldState } = context;
      const target = foldState.Target;

      if (!target) {
        logger.warn(
          {
            tenantId,
            scenarioRunId: foldState.ScenarioRunId,
            batchRunId: foldState.BatchRunId,
          },
          "Queued event has no target — skipping execution (legacy run without target)",
        );
        return;
      }

      const payload: ScenarioExecutionPayload = {
        projectId: tenantId,
        scenarioId: foldState.ScenarioId,
        scenarioRunId: foldState.ScenarioRunId,
        batchRunId: foldState.BatchRunId,
        setId: foldState.ScenarioSetId,
        target: {
          type: target.Type as "prompt" | "http" | "code",
          referenceId: target.ReferenceId,
        },
        attempt: 1,
      };

      await deps.executionQueue.send(payload);

      logger.debug(
        {
          tenantId,
          scenarioRunId: foldState.ScenarioRunId,
          batchRunId: foldState.BatchRunId,
          targetType: target.Type,
        },
        "Dispatched scenario execution job",
      );
    },
  };
}
