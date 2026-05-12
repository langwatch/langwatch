import { createLogger } from "../../../../../utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import {
  isSimulationRunStartedEvent,
  isSimulationRunFinishedEvent,
} from "../schemas/typeGuards";
import { isSuiteSetId } from "../../../../suites/suite-set-id";

const logger = createLogger(
  "langwatch:simulation-processing:suite-run-sync",
);

export interface SuiteRunSyncReactorDeps {
  recordSuiteRunItemStarted: (data: {
    tenantId: string;
    batchRunId: string;
    scenarioRunId: string;
    scenarioId: string;
    occurredAt: number;
  }) => Promise<void>;
  completeSuiteRunItem: (data: {
    tenantId: string;
    batchRunId: string;
    scenarioRunId: string;
    scenarioId: string;
    status: string;
    verdict?: string;
    durationMs?: number;
    reasoning?: string;
    error?: string;
    occurredAt: number;
  }) => Promise<void>;
}

/**
 * Cross-pipeline reactor that syncs simulation events to the suite run pipeline.
 *
 * Lives on the simulation pipeline (consumes simulation events).
 * Dispatches commands to the suite run pipeline.
 * Uses isSuiteSetId() to filter — only processes simulation runs belonging to suites.
 */
export function createSuiteRunSyncReactor(
  deps: SuiteRunSyncReactorDeps,
): ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData> {
  return {
    name: "suiteRunSync",
    options: {
      runIn: ["worker"],
    },

    async handle(
      event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      // Only process simulation runs that belong to suites
      if (!foldState.ScenarioSetId || !isSuiteSetId(foldState.ScenarioSetId)) {
        return;
      }

      try {
        if (isSimulationRunStartedEvent(event)) {
          await deps.recordSuiteRunItemStarted({
            tenantId,
            batchRunId: foldState.BatchRunId,
            scenarioRunId: foldState.ScenarioRunId,
            scenarioId: foldState.ScenarioId,
            occurredAt: event.occurredAt,
          });

          logger.debug(
            {
              tenantId,
              batchRunId: foldState.BatchRunId,
              scenarioRunId: foldState.ScenarioRunId,
            },
            "Dispatched recordSuiteRunItemStarted",
          );
          return;
        }

        if (isSimulationRunFinishedEvent(event)) {
          await deps.completeSuiteRunItem({
            tenantId,
            batchRunId: foldState.BatchRunId,
            scenarioRunId: foldState.ScenarioRunId,
            scenarioId: foldState.ScenarioId,
            status: foldState.Status,
            verdict: foldState.Verdict ?? undefined,
            durationMs: foldState.DurationMs ?? undefined,
            reasoning: foldState.Reasoning ?? undefined,
            error: foldState.Error ?? undefined,
            occurredAt: event.occurredAt,
          });

          logger.debug(
            {
              tenantId,
              batchRunId: foldState.BatchRunId,
              scenarioRunId: foldState.ScenarioRunId,
              status: foldState.Status,
            },
            "Dispatched completeSuiteRunItem",
          );
          return;
        }
      } catch (error) {
        logger.warn(
          {
            tenantId,
            batchRunId: foldState.BatchRunId,
            scenarioRunId: foldState.ScenarioRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to sync simulation event to suite run pipeline — non-fatal",
        );
      }
    },
  };
}
