/**
 * Shared polling-mode runner for evaluations-v3.
 *
 * Both the run API (POST /:slug/run) and the workflow evaluate endpoint
 * (POST /api/workflows/:id/evaluate) go through here so there is one backend
 * execution path: it registers a run, kicks the orchestrator off in the
 * background, and hands back the run id plus a shareable results URL the
 * caller can poll or open in the browser.
 */
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { createLogger } from "~/utils/logger/server";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { type OrchestratorInput, runOrchestrator } from "./orchestrator";
import { runStateManager } from "./runStateManager";
import { getRunUrl } from "./runUrl";
import type { EvaluationV3Event, ExecutionScope } from "./types";

const logger = createLogger("langwatch:experiments-v3:runner");

export type StartPollingRunInput = Omit<
  OrchestratorInput,
  "runId" | "scope" | "experimentId"
> & {
  experimentId: string;
  projectSlug: string;
  experimentSlug: string;
  /** Defaults to a full run when omitted. */
  scope?: ExecutionScope;
};

/**
 * Registers a run, starts the orchestrator in the background, and returns
 * immediately with the run id and results URL. The run streams its events into
 * the run-state manager so the caller can poll GET /runs/:runId(/results).
 */
export const startPollingRun = async (
  input: StartPollingRunInput,
): Promise<{ runId: string; runUrl: string; total: number }> => {
  const { projectSlug, experimentSlug, scope, ...orchestratorInput } = input;
  const effectiveScope: ExecutionScope = scope ?? { type: "full" };
  const totalCells =
    orchestratorInput.datasetRows.length *
    orchestratorInput.state.targets.length;
  const runId = generateHumanReadableId();
  const runUrl = getRunUrl(projectSlug, experimentSlug, runId);

  await runStateManager.createRun({
    runId,
    projectId: orchestratorInput.projectId,
    experimentId: orchestratorInput.experimentId,
    experimentSlug,
    total: totalCells,
  });

  const runExecution = async () => {
    try {
      const orchestrator = runOrchestrator({
        ...orchestratorInput,
        scope: effectiveScope,
        runId,
      });

      for await (const event of orchestrator) {
        await runStateManager.addEvent(runId, event as EvaluationV3Event);

        if (event.type === "done") {
          await runStateManager.completeRun(runId, {
            ...event.summary,
            runUrl,
          });
          break;
        }

        if (event.type === "stopped") {
          await runStateManager.stopRun(runId);
          break;
        }
      }
    } catch (error) {
      logger.error(
        {
          error,
          runId,
          experimentSlug,
          projectId: orchestratorInput.projectId,
        },
        "Execution error",
      );
      captureException(toError(error), {
        extra: {
          runId,
          experimentSlug,
          projectId: orchestratorInput.projectId,
        },
      });
      await runStateManager.failRun(runId, (error as Error).message);
    }
  };

  void runExecution();

  return { runId, runUrl, total: totalCells };
};
