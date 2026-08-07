/**
 * Shared polling-mode runner for evaluations-v3.
 *
 * Both the run API (POST /:slug/run) and the workflow evaluate endpoint
 * (POST /api/workflows/:id/evaluate) go through here so there is one backend
 * execution path: it registers a run, kicks the orchestrator off in the
 * background, and hands back the run id plus a shareable results URL the
 * caller can poll or open in the browser.
 */

import { createLogger } from "@langwatch/observability";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { type OrchestratorInput, runOrchestrator } from "./orchestrator";
import { mapThrownErrorEvent } from "./resultMapper";
import { runStateManager } from "./runStateManager";
import { getRunUrl } from "./runUrl";
import {
  type EvaluationV3Event,
  type ExecutionScope,
  UNNAMED_FAILURE,
} from "./types";

const logger = createLogger("langwatch:experiments-v3:runner");

const consumeOrchestratorEvents = async ({
  orchestrator,
  runId,
  runUrl,
}: {
  orchestrator: AsyncGenerator<EvaluationV3Event>;
  runId: string;
  runUrl: string;
}): Promise<void> => {
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
};

const handleExecutionError = async ({
  error,
  runId,
  experimentSlug,
  projectId,
}: {
  error: unknown;
  runId: string;
  experimentSlug: string;
  projectId: string;
}): Promise<void> => {
  // Through the same mapper the streaming path uses, so a polled run and a
  // streamed one report a failure identically: a handled error keeps its
  // code and travels as `domainError`; anything else is the unnamed-failure
  // marker plus the trace id.
  const failure = mapThrownErrorEvent({ error });
  const code = failure.type === "error" ? failure.message : UNNAMED_FAILURE;
  const traceId = failure.type === "error" ? failure.traceId : undefined;

  // The raw message stops here. This log line is where it belongs — with
  // the trace id that ties it to the run row the customer can see.
  logger.error(
    {
      error,
      runId,
      traceId,
      experimentSlug,
      projectId,
    },
    "Execution error",
  );
  captureException(toError(error), {
    extra: {
      runId,
      experimentSlug,
      projectId,
    },
  });
  await runStateManager.failRun(runId, {
    code,
    domainError: failure.type === "error" ? failure.domainError : undefined,
    traceId,
  });
};

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
  const rowCount =
    effectiveScope.type === "rows"
      ? effectiveScope.rowIndices.filter(
          (i) => i >= 0 && i < orchestratorInput.datasetRows.length,
        ).length
      : orchestratorInput.datasetRows.length;
  const totalCells = rowCount * orchestratorInput.state.targets.length;
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

      await consumeOrchestratorEvents({ orchestrator, runId, runUrl });
    } catch (error) {
      await handleExecutionError({
        error,
        runId,
        experimentSlug,
        projectId: orchestratorInput.projectId,
      });
    }
  };

  void runExecution();

  return { runId, runUrl, total: totalCells };
};
