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
import {
  applyRunEvent,
  emptyRunResultsDraft,
  generateHumanReadableId,
  InvalidExperimentConfigurationError,
  mergeRunResults,
  planRunMerge,
  runResultsAreEmpty,
  StaleWorkbenchStateError,
  UNNAMED_FAILURE,
  type EvaluationV3Event,
  type ExecutionScope,
  type ExecutionSummary,
  type ExperimentService,
  type RunResultsDraft,
  type WorkbenchActor,
} from "@langwatch/experiment-contract";
import { getRunUrl } from "../adapters/experiment-run-url.adapter";
import type { ExperimentRunErrorReportingPort } from "../ports/experiment-run-error-reporting.port";
import type { ExperimentRunProgressPort } from "../ports/experiment-run-progress.port";
import { mapThrownErrorEvent } from "../processes/experiment-result-mapping.process";
import {
  countScopedCells,
  type OrchestratorInput,
  runOrchestrator,
} from "./experiment-run-orchestrator.service";

const logger = createLogger("langwatch:experiment:polling-run");

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

export type StartPollingRunInput = Omit<OrchestratorInput, "runId" | "scope" | "experimentId"> & {
  experimentId: string;
  projectSlug: string;
  experimentSlug: string;
  /** The deployment's public base URL, for the shareable results link. */
  baseUrl: string;
  /** Where the run's progress is written so a poll on another process finds it. */
  progress: ExperimentRunProgressPort;
  /**
   * Where an unexpected failure is reported beyond the log line. Optional: a
   * deployment that composes none loses nothing the customer can see.
   */
  errorReporting?: ExperimentRunErrorReportingPort;
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
  errorReporting,
  isRetry = false,
}: {
  persistence: RunResultsPersistence;
  projectId: string;
  experimentId: string;
  runId: string;
  scope: ExecutionScope;
  draft: RunResultsDraft;
  errorReporting?: ExperimentRunErrorReportingPort;
  isRetry?: boolean;
}): Promise<void> => {
  if (runResultsAreEmpty(draft)) {
    logger.info({ runId, experimentId }, "Run produced no cells to write into the workbench state");
    return;
  }

  const plan = planRunMerge(scope);

  try {
    const current = await persistence.experiments.getWorkbenchState({
      projectId,
      id: experimentId,
    });
    if (!current.state) {
      throw new InvalidExperimentConfigurationError(current.slug);
    }

    const saved = await persistence.experiments.recordWorkbenchRunResults({
      projectId,
      id: experimentId,
      expectedVersion: current.version,
      // The run names itself on the write. A page that started this run then
      // reads the version bump as its own and adopts it, rather than standing
      // down and asking the reader to reload over their unsaved edits.
      actor: { ...persistence.actor, runId },
      commitMessage: `Results from run ${runId}`,
      results: mergeRunResults({ existing: current.state.results, draft, plan }),
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
        errorReporting,
        isRetry: true,
      });
      return;
    }

    logger.error(
      { error, runId, experimentId, projectId },
      "Failed to write the run results into the workbench state",
    );
    errorReporting?.captureException(error, {
      extra: { runId, experimentId, projectId },
    });
  }
};

/** Everything the orchestrator itself takes, minus what the runner decides. */
type RunnerOrchestratorInput = Omit<
  StartPollingRunInput,
  | "projectSlug"
  | "experimentSlug"
  | "scope"
  | "persistResults"
  | "baseUrl"
  | "progress"
  | "errorReporting"
>;

/**
 * Records a failed run, and says nothing the customer must not read.
 *
 * The mapper is the one the streaming path uses, so a polled run and a
 * streamed one report a failure identically: a handled error keeps its code
 * and travels as `domainError`; anything else is the unnamed-failure marker
 * plus the trace id. The raw message stops here, in the log line, next to the
 * trace id that ties it to the run row the customer can see.
 */
const reportFailedRun = async ({
  error,
  runId,
  experimentSlug,
  projectId,
  progress,
  errorReporting,
}: {
  error: unknown;
  runId: string;
  experimentSlug: string;
  projectId: string;
  progress: ExperimentRunProgressPort;
  errorReporting?: ExperimentRunErrorReportingPort;
}): Promise<void> => {
  const failure = mapThrownErrorEvent({ error });
  const code = failure.type === "error" ? failure.message : UNNAMED_FAILURE;
  const traceId = failure.type === "error" ? failure.traceId : undefined;

  logger.error({ error, runId, traceId, experimentSlug, projectId }, "Execution error");
  errorReporting?.captureException(error, {
    extra: { runId, experimentSlug, projectId },
  });
  await progress.failRun(runId, {
    code,
    domainError: failure.type === "error" ? failure.domainError : undefined,
    traceId,
  });
};

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
  progress,
  errorReporting,
}: {
  orchestratorInput: RunnerOrchestratorInput;
  scope: ExecutionScope;
  runId: string;
  runUrl: string;
  experimentSlug: string;
  persistResults?: RunResultsPersistence;
  progress: ExperimentRunProgressPort;
  errorReporting?: ExperimentRunErrorReportingPort;
}): Promise<void> => {
  const draft = emptyRunResultsDraft();

  /**
   * The cells go in before the run reports it ended, so a caller that polls
   * until it does and then reads the workbench finds them there.
   *
   * A stopped run writes them too. The rows that finished before the stop are
   * the run's whole output, and dropping them leaves the table reading "No
   * output yet" for work that did run.
   */
  const writeCellsBack = async (reason: "finished" | "stopped") => {
    logger.info(
      { runId, reason, persists: Boolean(persistResults) },
      "Run ended, deciding whether to write its cells back",
    );
    if (!persistResults) return;
    await persistRunResults({
      persistence: persistResults,
      projectId: orchestratorInput.projectId,
      experimentId: orchestratorInput.experimentId,
      runId,
      scope,
      draft,
      errorReporting,
    });
  };

  const finishRun = async (summary: ExecutionSummary) => {
    await writeCellsBack("finished");
    await progress.completeRun(runId, { ...summary, runUrl });
  };

  const stopRun = async () => {
    await writeCellsBack("stopped");
    await progress.stopRun(runId);
  };

  try {
    const orchestrator = runOrchestrator({
      ...orchestratorInput,
      scope,
      runId,
    });

    for await (const rawEvent of orchestrator) {
      const event = rawEvent as EvaluationV3Event;
      await progress.addEvent(runId, event);
      if (persistResults) applyRunEvent({ draft, event });

      if (event.type === "done") {
        await finishRun(event.summary);
        break;
      }

      if (event.type === "stopped") {
        await stopRun();
        break;
      }
    }
  } catch (error) {
    await reportFailedRun({
      error,
      runId,
      experimentSlug,
      projectId: orchestratorInput.projectId,
      progress,
      errorReporting,
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
    baseUrl,
    progress,
    errorReporting,
    ...orchestratorInput
  } = input;
  const effectiveScope: ExecutionScope = scope ?? { type: "full" };
  const totalCells = countScopedCells({
    state: orchestratorInput.state,
    datasetRows: orchestratorInput.datasetRows,
    scope: effectiveScope,
    ...(orchestratorInput.seedTargetOutputs
      ? { seedTargetOutputs: orchestratorInput.seedTargetOutputs }
      : {}),
  });
  const runId = generateHumanReadableId();
  const runUrl = getRunUrl({ baseUrl, projectSlug, experimentSlug, runId });

  await progress.createRun({
    runId,
    projectId: orchestratorInput.projectId,
    experimentId: orchestratorInput.experimentId,
    experimentSlug,
    total: totalCells,
  });

  // The last handler on this promise. `runExecution` reports a failed run
  // itself, so a rejection reaching here means its own recovery failed too (an
  // unreachable run-state store rejects both the event write and the failure
  // write). Without a handler that rejection is unhandled, which ends the
  // process under Node's default.
  void runExecution({
    orchestratorInput,
    scope: effectiveScope,
    runId,
    runUrl,
    experimentSlug,
    persistResults,
    progress,
    errorReporting,
  }).catch((error: unknown) => {
    logger.error(
      {
        error,
        runId,
        experimentSlug,
        projectId: orchestratorInput.projectId,
      },
      "Run execution could not record its own failure",
    );
    errorReporting?.captureException(error, {
      extra: {
        runId,
        experimentSlug,
        projectId: orchestratorInput.projectId,
      },
    });
  });

  return { runId, runUrl, total: totalCells };
};
