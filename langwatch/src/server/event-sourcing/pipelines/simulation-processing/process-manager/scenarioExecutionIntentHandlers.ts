import { createLogger } from "@langwatch/observability";

import type { IntentExecutor } from "~/server/event-sourcing/pipeline/processManagerDefinition";

import type { ScenarioExecutionFailRunIntent } from "./scenarioExecutionProcess.types";

const logger = createLogger(
  "langwatch:simulation-processing:scenario-execution-process",
);

/** What the terminal write needs from the scenario domain. */
export interface ScenarioExecutionDispatchDeps {
  /**
   * Writes the run's terminal event. Idempotent — `finishRun` collapses a
   * repeat — which is what makes retrying this intent safe.
   */
  emitFailure: (params: {
    projectId: string;
    scenarioId: string;
    setId: string;
    batchRunId: string;
    scenarioRunId: string;
    error: string;
    name?: string;
    description?: string;
    cancelled?: boolean;
  }) => Promise<void>;
  /** Scenario display fields, so a reaped run reads like any other in the UI. */
  lookupScenario: (params: {
    projectId: string;
    scenarioId: string;
  }) => Promise<{ name: string; situation: string } | null>;
}

/**
 * Executes the `failRun` intent: records that a run nobody is executing any
 * more has ended.
 *
 * Throwing is the right response to an infrastructure fault here — the outbox
 * retries, and the alternative is a run that stays non-terminal forever, which
 * is the failure this process exists to remove. That is the opposite of the
 * scenario's own execution contract, which must never retry; nothing is
 * re-executed here, only the record of the run's death is written.
 */
export function createScenarioExecutionFailRunHandler(
  deps: ScenarioExecutionDispatchDeps,
): IntentExecutor<ScenarioExecutionFailRunIntent> {
  return async (payload) => {
    // Best-effort: display fields are cosmetic, and failing to read them must
    // not stop the terminal event being written.
    const scenario = await deps
      .lookupScenario({
        projectId: payload.projectId,
        scenarioId: payload.scenarioId,
      })
      .catch((err: unknown) => {
        logger.warn(
          { err, scenarioRunId: payload.scenarioRunId },
          "Could not read scenario display fields for a reaped run",
        );
        return null;
      });

    logger.info(
      {
        projectId: payload.projectId,
        scenarioRunId: payload.scenarioRunId,
        batchRunId: payload.batchRunId,
        cancelled: payload.cancelled,
      },
      "Deadline fired for a scenario run with no live worker — writing terminal state",
    );

    await deps.emitFailure({
      projectId: payload.projectId,
      scenarioId: payload.scenarioId,
      setId: payload.setId,
      batchRunId: payload.batchRunId,
      scenarioRunId: payload.scenarioRunId,
      error: payload.reason,
      name: scenario?.name,
      description: scenario?.situation,
      cancelled: payload.cancelled,
    });
  };
}
