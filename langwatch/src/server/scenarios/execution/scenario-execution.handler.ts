/**
 * Scenario execution handler — processes jobs from the dedicated execution queue.
 *
 * Checks fold state before executing (skip if terminal, give up if max attempts exceeded).
 * On failure, dispatches finishRun with ERROR status to the simulation pipeline.
 */

import { createLogger } from "~/utils/logger/server";
import type { SimulationRunStateData } from "~/server/event-sourcing/pipelines/simulation-processing/projections/simulationRunState.foldProjection";
import type { SimulationVerdict } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/shared";
import { ScenarioExecutor } from "./scenario-executor";
import type { ScenarioExecutionPayload } from "./scenario-execution.queue";

const logger = createLogger("langwatch:scenarios:execution-handler");

const MAX_EXECUTION_ATTEMPTS =
  Number(process.env.SCENARIO_MAX_ATTEMPTS) || 3;

const TERMINAL_STATUSES = new Set([
  "SUCCESS",
  "FAILURE",
  "ERROR",
  "CANCELLED",
  "STALLED",
]);

export interface ScenarioExecutionHandlerDeps {
  executor: ScenarioExecutor;
  getFoldState: (params: {
    tenantId: string;
    scenarioRunId: string;
  }) => Promise<SimulationRunStateData | null>;
  dispatchFinishRun: (data: {
    tenantId: string;
    scenarioRunId: string;
    status?: string;
    results?: {
      verdict: SimulationVerdict;
      reasoning?: string;
      metCriteria: string[];
      unmetCriteria: string[];
      error?: string;
    };
    durationMs?: number;
    occurredAt: number;
  }) => Promise<void>;
}

/**
 * Creates the handler function for the scenario execution queue.
 */
export function createScenarioExecutionHandler(
  deps: ScenarioExecutionHandlerDeps,
): (payload: ScenarioExecutionPayload) => Promise<void> {
  return async (payload: ScenarioExecutionPayload): Promise<void> => {
    const {
      projectId,
      scenarioId,
      scenarioRunId,
      batchRunId,
      setId,
      target,
      attempt,
    } = payload;

    const handlerLogger = logger.child({
      scenarioId,
      projectId,
      scenarioRunId,
      batchRunId,
      attempt,
    });

    // Check fold state — skip if already terminal
    const foldState = await deps.getFoldState({
      tenantId: projectId,
      scenarioRunId,
    });

    if (foldState && TERMINAL_STATUSES.has(foldState.Status)) {
      handlerLogger.info(
        { status: foldState.Status },
        "Skipping execution — run already in terminal status",
      );
      return;
    }

    // Check attempts — give up if max exceeded
    const currentAttempts = foldState?.Attempts ?? 0;
    if (currentAttempts >= MAX_EXECUTION_ATTEMPTS) {
      handlerLogger.warn(
        { attempts: currentAttempts, maxAttempts: MAX_EXECUTION_ATTEMPTS },
        "Max execution attempts exceeded",
      );
      await deps.dispatchFinishRun({
        tenantId: projectId,
        scenarioRunId,
        status: "ERROR",
        results: {
          verdict: "failure",
          reasoning: `Max execution attempts exceeded (${currentAttempts}/${MAX_EXECUTION_ATTEMPTS})`,
          metCriteria: [],
          unmetCriteria: [],
          error: `Max execution attempts exceeded (${currentAttempts}/${MAX_EXECUTION_ATTEMPTS})`,
        },
        occurredAt: Date.now(),
      });
      return;
    }

    try {
      const result = await deps.executor.execute({
        projectId,
        scenarioId,
        scenarioRunId,
        batchRunId,
        setId,
        target,
        attempt,
      });

      if (!result.success) {
        handlerLogger.warn(
          { error: result.error },
          "Scenario execution failed, dispatching finishRun ERROR",
        );
        await deps.dispatchFinishRun({
          tenantId: projectId,
          scenarioRunId,
          status: "ERROR",
          results: {
            verdict: "failure",
            reasoning: result.error ?? "Scenario execution failed",
            metCriteria: [],
            unmetCriteria: [],
            error: result.error ?? "Scenario execution failed",
          },
          occurredAt: Date.now(),
        });
      }
      // On success: no-op — child reports via SDK
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      handlerLogger.error(
        { error: errorMessage },
        "Unexpected error during scenario execution",
      );

      await deps.dispatchFinishRun({
        tenantId: projectId,
        scenarioRunId,
        status: "ERROR",
        results: {
          verdict: "failure",
          reasoning: `Unexpected execution error: ${errorMessage}`,
          metCriteria: [],
          unmetCriteria: [],
          error: errorMessage,
        },
        occurredAt: Date.now(),
      });

      // Re-throw so GroupQueueProcessor retries
      throw error;
    }
  };
}
