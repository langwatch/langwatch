/**
 * Where a run's cells reach the saved workbench state.
 *
 * Both execution paths end here. The polling runner calls the write directly
 * at the point it decides the run ended; a streaming run started by an open
 * page feeds its frames through the writer, which folds them and writes them
 * when the last frame arrives.
 *
 * The page saves the same cells itself, so the streaming write looks like a
 * duplicate. It is not: the page's save depends on the tab. A browser that
 * puts a background tab to sleep holds the save timer, and a connection that
 * drops before the last frame loses the cells the page had. Either way the run
 * is complete in its own record and the board still reads "No output yet". The
 * server holds every frame it sent, so it can write what the page could not.
 */

import { createLogger } from "@langwatch/observability";
import {
  applyRunEvent,
  emptyRunResultsDraft,
  InvalidExperimentConfigurationError,
  mergeRunResults,
  planRunMerge,
  runResultsAreEmpty,
  runsSavedDataset,
  StaleWorkbenchStateError,
  type EvaluationV3Event,
  type ExecutionScope,
  type ExperimentService,
  type RunResultsDraft,
  type WorkbenchActor,
} from "@langwatch/experiment-contract";
import type { ExperimentRunErrorReportingPort } from "../ports/experiment-run-error-reporting.port";

const logger = createLogger("langwatch:experiment:run-results-writer");

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

/**
 * Writes a completed run's cells into the saved workbench state.
 *
 * Never throws: the cells are already stored, so a workbench that could not be
 * updated costs the open page a refresh, not the run. One retry covers the
 * concurrent write (a person typing in the same experiment), which is the same
 * answer the assistant's backend edits give a stale read.
 */
export const persistRunResults = async ({
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

/** What a streaming run feeds its frames into so its cells reach the board. */
export interface RunResultsWriter {
  /**
   * Record one frame. The cells are written when the run reports it ended,
   * which is `done` or `stopped`.
   */
  record(event: EvaluationV3Event): Promise<void>;
}

/**
 * The writer a streaming run gets, or none when the run must leave the board
 * alone.
 *
 * An experiment that was never saved has no state to write into. A run given
 * its own rows, another saved dataset or constant parameters produces cells
 * that do not line up with the rows the workbench shows, which is the same
 * rule the polling runner applies before it passes its persistence.
 */
export const runResultsWriterFor = ({
  persistence,
  projectId,
  experimentId,
  scope,
  data,
  datasetId,
  parameters,
  errorReporting,
}: {
  persistence: RunResultsPersistence;
  projectId: string;
  experimentId?: string | undefined;
  scope: ExecutionScope;
  data?: Array<Record<string, unknown>> | undefined;
  datasetId?: string | undefined;
  parameters?: Record<string, string | number | boolean> | undefined;
  errorReporting?: ExperimentRunErrorReportingPort;
}): RunResultsWriter | undefined => {
  if (!experimentId) return undefined;

  const runsTheBoard = runsSavedDataset({
    ...(data !== undefined ? { data } : {}),
    ...(datasetId !== undefined ? { dataset_id: datasetId } : {}),
    ...(parameters !== undefined ? { parameters } : {}),
  });
  if (!runsTheBoard) return undefined;

  return createRunResultsWriter({
    persistence,
    projectId,
    experimentId,
    scope,
    ...(errorReporting ? { errorReporting } : {}),
  });
};

/** Open a writer for one streaming run of one experiment. */
export const createRunResultsWriter = ({
  persistence,
  projectId,
  experimentId,
  scope,
  errorReporting,
}: {
  persistence: RunResultsPersistence;
  projectId: string;
  experimentId: string;
  scope: ExecutionScope;
  errorReporting?: ExperimentRunErrorReportingPort;
}): RunResultsWriter => {
  const draft = emptyRunResultsDraft();
  let written = false;

  return {
    async record(event: EvaluationV3Event): Promise<void> {
      applyRunEvent({ draft, event });

      if (event.type !== "done" && event.type !== "stopped") return;
      // A run reports it ended once. A second terminal frame would write the
      // same cells again and take a second version number for them.
      if (written) return;
      written = true;

      // The frame that names the run is the first one the orchestrator sends.
      // A stream that ended before it arrived carries no cells either, so
      // there is nothing to write.
      const runId = draft.runId;
      if (!runId) return;

      await persistRunResults({
        persistence,
        projectId,
        experimentId,
        runId,
        scope,
        draft,
        ...(errorReporting ? { errorReporting } : {}),
      });
    },
  };
};
