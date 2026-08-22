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
import { StaleWorkbenchStateError } from "~/server/experiments/errors";
import type {
  ExperimentService,
  WorkbenchActor,
} from "~/server/experiments/experiment.service";
import { generateHumanReadableId } from "~/utils/humanReadableId";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { type OrchestratorInput, runOrchestrator } from "./orchestrator";
import { mapThrownErrorEvent } from "./resultMapper";
import {
  applyRunEvent,
  emptyRunResultsDraft,
  mergeRunResults,
  planRunMerge,
  type RunResultsDraft,
  runResultsAreEmpty,
} from "./runResults";
import { runStateManager } from "./runStateManager";
import { getRunUrl } from "./runUrl";
import {
  type EvaluationV3Event,
  type ExecutionScope,
  type ExecutionSummary,
  UNNAMED_FAILURE,
} from "./types";

const logger = createLogger("langwatch:experiments-v3:runner");

/**
 * Where a completed run writes its cells so an open page can show them.
 *
 * The workbench state is the canonical home of a run's cells: a browser run
 * autosaves them there, and a page that opens later reads them back. A backend
 * run has no page to stream to, so it writes them itself through the same
 * server-owned seam, which validates the state, advances the version and tells
 * the tenant the experiment moved.
 */
export interface RunResultsPersistence {
  experiments: ExperimentService;
  /** Who the workbench write is attributed to in the version history. */
  actor: WorkbenchActor;
}

export type StartPollingRunInput = Omit<
  OrchestratorInput,
  "runId" | "scope" | "experimentId"
> & {
  experimentId: string;
  projectSlug: string;
  experimentSlug: string;
  /** Defaults to a full run when omitted. */
  scope?: ExecutionScope;
  /**
   * Set only for a run of the SAVED dataset. A run given its own rows or
   * parameters produces cells that do not line up with the rows the workbench
   * shows, so it leaves the saved state alone.
   */
  persistResults?: RunResultsPersistence;
};

/**
 * Writes a completed run's cells into the saved workbench state.
 *
 * Never throws: the cells are already stored, so a workbench that could not be
 * updated costs the open page a refresh, not the run. One retry covers the
 * concurrent write (a person typing in the same experiment), which is the same
 * answer the assistant's backend edits give a stale read.
 */
const persistRunResults = async ({
  persistence,
  projectId,
  experimentId,
  runId,
  scope,
  draft,
  isRetry = false,
}: {
  persistence: RunResultsPersistence;
  projectId: string;
  experimentId: string;
  runId: string;
  scope: ExecutionScope;
  draft: RunResultsDraft;
  isRetry?: boolean;
}): Promise<void> => {
  if (runResultsAreEmpty(draft)) {
    logger.info(
      { runId, experimentId },
      "Run produced no cells to write into the workbench state",
    );
    return;
  }

  const plan = planRunMerge(scope);

  try {
    const saved = await persistence.experiments.applyWorkbenchTransform({
      projectId,
      id: experimentId,
      actor: persistence.actor,
      commitMessage: `Results from run ${runId}`,
      transform: (state) => ({
        ...state,
        results: mergeRunResults({ existing: state.results, draft, plan }),
      }),
    });
    logger.info(
      {
        runId,
        experimentId,
        version: saved.version,
        targets: Object.keys(draft.targetOutputs).length,
      },
      "Wrote the run results into the workbench state",
    );
  } catch (error) {
    if (error instanceof StaleWorkbenchStateError && !isRetry) {
      logger.info(
        { runId, experimentId },
        "Workbench moved while the run was writing its results, retrying once",
      );
      await persistRunResults({
        persistence,
        projectId,
        experimentId,
        runId,
        scope,
        draft,
        isRetry: true,
      });
      return;
    }

    logger.error(
      { error, runId, experimentId, projectId },
      "Failed to write the run results into the workbench state",
    );
    captureException(toError(error), {
      extra: { runId, experimentId, projectId },
    });
  }
};

/** Everything the orchestrator itself takes, minus what the runner decides. */
type RunnerOrchestratorInput = Omit<
  StartPollingRunInput,
  "projectSlug" | "experimentSlug" | "scope" | "persistResults"
>;

/**
 * Consumes the orchestrator's events until the run ends: every event goes to
 * the run-state manager for pollers, and, when the run may write them, into
 * the draft that becomes the workbench's cells.
 */
const runExecution = async ({
  orchestratorInput,
  scope,
  runId,
  runUrl,
  experimentSlug,
  persistResults,
}: {
  orchestratorInput: RunnerOrchestratorInput;
  scope: ExecutionScope;
  runId: string;
  runUrl: string;
  experimentSlug: string;
  persistResults?: RunResultsPersistence;
}): Promise<void> => {
  const draft = emptyRunResultsDraft();

  const finishRun = async (summary: ExecutionSummary) => {
    // The cells go in before the run reports completed, so a caller that polls
    // until it does and then reads the workbench finds them there.
    logger.info(
      { runId, persists: Boolean(persistResults) },
      "Run finished, deciding whether to write its cells back",
    );
    if (persistResults) {
      await persistRunResults({
        persistence: persistResults,
        projectId: orchestratorInput.projectId,
        experimentId: orchestratorInput.experimentId,
        runId,
        scope,
        draft,
      });
    }
    await runStateManager.completeRun(runId, { ...summary, runUrl });
  };

  try {
    const orchestrator = runOrchestrator({
      ...orchestratorInput,
      scope,
      runId,
    });

    for await (const rawEvent of orchestrator) {
      const event = rawEvent as EvaluationV3Event;
      await runStateManager.addEvent(runId, event);
      if (persistResults) applyRunEvent({ draft, event });

      if (event.type === "done") {
        await finishRun(event.summary);
        break;
      }

      if (event.type === "stopped") {
        await runStateManager.stopRun(runId);
        break;
      }
    }
  } catch (error) {
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
    await runStateManager.failRun(runId, {
      code,
      domainError: failure.type === "error" ? failure.domainError : undefined,
      traceId,
    });
  }
};

/**
 * Registers a run, starts the orchestrator in the background, and returns
 * immediately with the run id and results URL. The run streams its events into
 * the run-state manager so the caller can poll GET /runs/:runId(/results).
 */
export const startPollingRun = async (
  input: StartPollingRunInput,
): Promise<{ runId: string; runUrl: string; total: number }> => {
  const {
    projectSlug,
    experimentSlug,
    scope,
    persistResults,
    ...orchestratorInput
  } = input;
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

  void runExecution({
    orchestratorInput,
    scope: effectiveScope,
    runId,
    runUrl,
    experimentSlug,
    persistResults,
  });

  return { runId, runUrl, total: totalCells };
};
