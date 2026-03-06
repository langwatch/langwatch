import { createLogger } from "../../../../../utils/logger/server";
import type {
  ReactorContext,
  ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";
import { isSimulationRunStartedEvent, isSimulationRunFinishedEvent } from "../schemas/typeGuards";
import { isSuiteSetId, extractSuiteId } from "../../../../suites/suite-set-id";
import type { RecordScenarioResultCommandData, StartScenarioCommandData } from "../../suite-run-processing/schemas/commands";

const logger = createLogger(
  "langwatch:simulation-processing:suite-run-progress-forwarder",
);

const TERMINAL_STATUSES = new Set(["SUCCESS", "FAILURE", "ERROR", "CANCELLED"]);

export interface SuiteRunProgressForwarderDeps {
  startScenario: (data: StartScenarioCommandData) => Promise<unknown>;
  recordScenarioResult: (data: RecordScenarioResultCommandData) => Promise<unknown>;
}

/**
 * Cross-pipeline reactor that forwards terminal simulation run completions
 * to the suite-run-processing pipeline.
 *
 * Fires only on SimulationRunFinishedEvent for simulation runs that belong
 * to a suite (identified by isSuiteSetId on the ScenarioSetId).
 *
 * Non-fatal: logs and swallows errors to prevent blocking simulation pipeline.
 */
export function createSuiteRunProgressForwarderReactor(
  deps: SuiteRunProgressForwarderDeps,
): ReactorDefinition<SimulationProcessingEvent, SimulationRunStateData> {
  return {
    name: "suiteRunProgressForwarder",
    options: {
      runIn: ["worker"],
      makeJobId: (payload) =>
        `suite-fwd:${payload.event.tenantId}:${payload.event.aggregateId}`,
      ttl: 0,
    },

    async handle(
      event: SimulationProcessingEvent,
      context: ReactorContext<SimulationRunStateData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      if (!isSuiteSetId(foldState.ScenarioSetId)) return;

      const suiteId = extractSuiteId(foldState.ScenarioSetId);
      if (!suiteId) return;

      if (isSimulationRunStartedEvent(event)) {
        try {
          await deps.startScenario({
            tenantId,
            suiteId,
            batchRunId: foldState.BatchRunId,
            scenarioRunId: foldState.ScenarioRunId,
            scenarioId: foldState.ScenarioId,
            targetReferenceId: "",
            targetType: "",
            occurredAt: Date.now(),
          });

          logger.debug(
            {
              tenantId,
              suiteId,
              batchRunId: foldState.BatchRunId,
              scenarioRunId: foldState.ScenarioRunId,
            },
            "Forwarded scenario started to suite run pipeline",
          );
        } catch (error) {
          logger.warn(
            {
              tenantId,
              suiteId,
              scenarioRunId: foldState.ScenarioRunId,
              error: error instanceof Error ? error.message : String(error),
            },
            "Failed to forward scenario started to suite run pipeline — non-fatal",
          );
        }
        return;
      }

      if (!isSimulationRunFinishedEvent(event)) return;

      const status = foldState.Status.toUpperCase();
      if (!TERMINAL_STATUSES.has(status)) return;

      try {
        await deps.recordScenarioResult({
          tenantId,
          suiteId,
          batchRunId: foldState.BatchRunId,
          scenarioRunId: foldState.ScenarioRunId,
          scenarioId: foldState.ScenarioId,
          targetReferenceId: "",
          targetType: "",
          status,
          verdict: foldState.Verdict,
          durationMs: foldState.DurationMs,
          occurredAt: Date.now(),
        });

        logger.debug(
          {
            tenantId,
            suiteId,
            batchRunId: foldState.BatchRunId,
            scenarioRunId: foldState.ScenarioRunId,
            status,
          },
          "Forwarded scenario result to suite run pipeline",
        );
      } catch (error) {
        logger.warn(
          {
            tenantId,
            suiteId,
            scenarioRunId: foldState.ScenarioRunId,
            error: error instanceof Error ? error.message : String(error),
          },
          "Failed to forward scenario result to suite run pipeline — non-fatal",
        );
      }
    },
  };
}
