/**
 * Where a run's cells reach the saved workbench state.
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
 */
export interface RunResultsPersistence {
  experiments: ExperimentService;
  /** Who the workbench write is attributed to in the version history. */
  actor: WorkbenchActor;
}

/**
 * What a streaming run feeds its frames into so its cells reach the board.
 */
export interface RunResultsWriter {
  /**
   * Record one frame. The cells are written when the run reports it ended,
   * which is `done` or `stopped`.
   */
  record(event: EvaluationV3Event): Promise<void>;
}

/**
 * The writer a streaming run gets, and the write both execution paths end
 * in: writes a completed run's cells into the saved workbench state.
 */
export class ExperimentRunResultsWriterService implements RunResultsWriter {
  private readonly draft = emptyRunResultsDraft();
  private written = false;

  private constructor(
    private readonly options: {
      persistence: RunResultsPersistence;
      projectId: string;
      experimentId: string;
      scope: ExecutionScope;
      errorReporting?: ExperimentRunErrorReportingPort;
    },
  ) {}

  /** Opens a writer for one streaming run of one experiment. */
  static create(options: {
    persistence: RunResultsPersistence;
    projectId: string;
    experimentId: string;
    scope: ExecutionScope;
    errorReporting?: ExperimentRunErrorReportingPort;
  }): ExperimentRunResultsWriterService {
    return new ExperimentRunResultsWriterService(options);
  }

  /** The writer a run gets, or none when the run must leave the board alone. */
  static tryWriterFor({
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
  }): ExperimentRunResultsWriterService | undefined {
    if (!experimentId) {
      return undefined;
    }

    const runsTheBoard = runsSavedDataset({
      ...(data !== undefined ? { data } : {}),
      ...(datasetId !== undefined ? { dataset_id: datasetId } : {}),
      ...(parameters !== undefined ? { parameters } : {}),
    });
    if (!runsTheBoard) {
      return undefined;
    }

    return ExperimentRunResultsWriterService.create({
      persistence,
      projectId,
      experimentId,
      scope,
      ...(errorReporting ? { errorReporting } : {}),
    });
  }

  static async persistRunResults({
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
  }): Promise<void> {
    if (runResultsAreEmpty(draft)) {
      logger.info(
        { runId, experimentId },
        "Run produced no cells to write into the workbench state",
      );

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
        await ExperimentRunResultsWriterService.persistRunResults({
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
  }

  async record(event: EvaluationV3Event): Promise<void> {
    applyRunEvent({ draft: this.draft, event });

    if (event.type !== "done" && event.type !== "stopped") {
      return;
    }

    // A run reports it ended once. A second terminal frame would write the
    // same cells again and take a second version number for them.
    if (this.written) {
      return;
    }

    this.written = true;

    // The frame that names the run is the first one the orchestrator sends.
    // A stream that ended before it arrived carries no cells either, so
    // there is nothing to write.
    const runId = this.draft.runId;
    if (!runId) {
      return;
    }

    await ExperimentRunResultsWriterService.persistRunResults({
      persistence: this.options.persistence,
      projectId: this.options.projectId,
      experimentId: this.options.experimentId,
      runId,
      scope: this.options.scope,
      draft: this.draft,
      ...(this.options.errorReporting ? { errorReporting: this.options.errorReporting } : {}),
    });
  }
}
