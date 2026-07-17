import { createLogger } from "@langwatch/observability";
import { isSuiteSetId } from "../../../../suites/suite-set-id";
import type {
  SubscriberSpec,
  TriggerContext,
} from "../../../pipeline/processManagerDefinition";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";
import {
  isSimulationRunFinishedEvent,
  isSimulationRunStartedEvent,
} from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:simulation-processing:suite-run-sync",
);

export interface SuiteRunSyncSubscriberDeps {
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
 * Cross-pipeline subscriber that syncs simulation events to the suite run
 * pipeline.
 *
 * Lives on the simulation pipeline (consumes simulation events).
 * Dispatches commands to the suite run pipeline.
 * Uses isSuiteSetId() to filter — only processes simulation runs belonging
 * to suites.
 */
export function createSuiteRunSyncSubscriber(
  deps: SuiteRunSyncSubscriberDeps,
): { name: string; spec: SubscriberSpec<SimulationProcessingEvent> } {
  return {
    name: "suiteRunSync",
    spec: {
      fold: "simulationRunState",
      events: [
        SIMULATION_RUN_EVENT_TYPES.STARTED,
        SIMULATION_RUN_EVENT_TYPES.FINISHED,
      ],
      // STARTED and FINISHED for the same run must never collapse into one
      // job (the legacy reactor had no dedup at all), so the collapse
      // identity includes the event type.
      dedupId: (event) =>
        `${event.tenantId}:${String(event.aggregateId)}:${event.type}`,

      handler: async (
        event: SimulationProcessingEvent,
        context: TriggerContext<SimulationRunStateData>,
      ): Promise<void> => {
        const { tenantId, state } = context;

        // Only process simulation runs that belong to suites
        if (!state.ScenarioSetId || !isSuiteSetId(state.ScenarioSetId)) {
          return;
        }

        try {
          if (isSimulationRunStartedEvent(event)) {
            await deps.recordSuiteRunItemStarted({
              tenantId,
              batchRunId: state.BatchRunId,
              scenarioRunId: state.ScenarioRunId,
              scenarioId: state.ScenarioId,
              occurredAt: event.occurredAt,
            });

            logger.debug(
              {
                tenantId,
                batchRunId: state.BatchRunId,
                scenarioRunId: state.ScenarioRunId,
              },
              "Dispatched recordSuiteRunItemStarted",
            );
            return;
          }

          if (isSimulationRunFinishedEvent(event)) {
            await deps.completeSuiteRunItem({
              tenantId,
              batchRunId: state.BatchRunId,
              scenarioRunId: state.ScenarioRunId,
              scenarioId: state.ScenarioId,
              status: state.Status,
              verdict: state.Verdict ?? undefined,
              durationMs: state.DurationMs ?? undefined,
              reasoning: state.Reasoning ?? undefined,
              error: state.Error ?? undefined,
              occurredAt: event.occurredAt,
            });

            logger.debug(
              {
                tenantId,
                batchRunId: state.BatchRunId,
                scenarioRunId: state.ScenarioRunId,
                status: state.Status,
              },
              "Dispatched completeSuiteRunItem",
            );
            return;
          }
        } catch (error) {
          logger.warn(
            {
              tenantId,
              batchRunId: state.BatchRunId,
              scenarioRunId: state.ScenarioRunId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to sync simulation event to suite run pipeline — non-fatal",
          );
        }
      },
    },
  };
}
