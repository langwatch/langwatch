/**
 * Scenario run cancellation logic.
 *
 * Uses event-sourcing for cancellation: dispatches cancel_requested events
 * which are processed by the simulationRunExecution process manager
 * (ADR-052). The process manager publishes the cancellation to all workers
 * via Redis pub/sub (outbox-durable, with retries); each worker checks if it
 * owns the scenario and kills its child process. A cancel-grace wake
 * force-terminates the run if no worker ever confirms.
 *
 * - Active jobs: killed by the worker that owns the child process
 * - Queued jobs: finished CANCELLED straight away rather than waiting out the
 *   grace window. They are still broadcast: a run is submitted to the pool
 *   when it is queued, so it may be buffered behind a busy slot, and the
 *   broadcast is what stops the pool spawning it.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { createLogger } from "@langwatch/observability";
import { isCancellableStatus } from "./scenario-event.enums";
import type { ScenarioRunData } from "./scenario-event.types";

const logger = createLogger("langwatch:scenarios:cancellation");

/** Parameters for cancelling a single scenario job. */
export interface CancelJobParams {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
  scenarioRunId: string;
  scenarioId: string;
}

/** Parameters for cancelling all remaining jobs in a batch run. */
export interface CancelBatchRunParams {
  projectId: string;
  scenarioSetId: string;
  batchRunId: string;
}

/** Result of cancelling a single job. */
export interface CancelJobResult {
  cancelled: boolean;
}

/** Result of cancelling a batch run. */
export interface CancelBatchRunResult {
  cancelledCount: number;
  skippedCount: number;
}

/** Dependencies injected into the cancellation service. */
export interface CancellationServiceDeps {
  /** Read run state from CH/ES fold projections. */
  getRunsForBatch: (params: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
  }) => Promise<ScenarioRunData[]>;
  /** Dispatch a cancel_requested event via the event-sourcing pipeline. */
  dispatchCancelRequested: (params: {
    tenantId: string;
    scenarioRunId: string;
    occurredAt: number;
  }) => Promise<void>;
}

/**
 * Service responsible for cancelling scenario runs via event-sourcing.
 *
 * Dispatches cancel_requested events. The simulationRunExecution process
 * manager publishes the cancellation to workers, and the worker owning the
 * scenario kills its child process.
 */
export class ScenarioCancellationService {
  private readonly getRunsForBatch: CancellationServiceDeps["getRunsForBatch"];
  private readonly dispatchCancelRequested: CancellationServiceDeps["dispatchCancelRequested"];

  constructor(deps: CancellationServiceDeps) {
    this.getRunsForBatch = deps.getRunsForBatch;
    this.dispatchCancelRequested = deps.dispatchCancelRequested;
  }

  /**
   * Cancel a single scenario run.
   *
   * 1. Check fold projection — if already terminal, skip
   * 2. Dispatch cancel_requested event — the process manager takes it from
   *    there (worker broadcast + force-terminal backstop)
   */
  async cancelJob(params: CancelJobParams): Promise<CancelJobResult> {
    const { projectId, scenarioRunId, batchRunId, scenarioSetId } = params;

    logger.info(
      { projectId, scenarioRunId, batchRunId },
      "Cancelling scenario job",
    );

    // Check current status from fold projection — if already terminal, skip
    const runs = await this.getRunsForBatch({
      projectId,
      scenarioSetId,
      batchRunId,
    });
    const run = runs.find((r) => r.scenarioRunId === scenarioRunId);
    if (run && !isCancellableStatus(run.status)) {
      logger.debug(
        { scenarioRunId, status: run.status },
        "Run already terminal, nothing to cancel",
      );
      return { cancelled: false };
    }

    const now = Date.now();

    // Dispatch cancel_requested event — the process manager broadcasts to
    // all workers; queued runs are finished CANCELLED by the process manager
    // itself since no worker will ever pick them up.
    await this.dispatchCancelRequested({
      tenantId: projectId,
      scenarioRunId,
      occurredAt: now,
    });

    logger.info(
      { projectId, scenarioRunId, status: run?.status },
      "Cancellation event dispatched",
    );
    return { cancelled: true };
  }

  /**
   * Cancel all remaining (non-terminal) jobs in a batch run.
   *
   * Reads run state from fold projections and cancels each cancellable run.
   */
  async cancelBatchRun(
    params: CancelBatchRunParams,
  ): Promise<CancelBatchRunResult> {
    const { projectId, scenarioSetId, batchRunId } = params;

    logger.info(
      { projectId, scenarioSetId, batchRunId },
      "Cancelling batch run",
    );

    const runs = await this.getRunsForBatch({
      projectId,
      scenarioSetId,
      batchRunId,
    });

    if (runs.length === 0) {
      return { cancelledCount: 0, skippedCount: 0 };
    }

    const cancellableRuns = runs.filter((run) =>
      isCancellableStatus(run.status),
    );
    const skippedCount = runs.length - cancellableRuns.length;

    // Cancel in parallel with concurrency limit
    const CONCURRENCY = 10;
    let cancelledCount = 0;

    for (let i = 0; i < cancellableRuns.length; i += CONCURRENCY) {
      const chunk = cancellableRuns.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        chunk.map((run) =>
          this.cancelJob({
            projectId,
            scenarioSetId,
            batchRunId: run.batchRunId,
            scenarioRunId: run.scenarioRunId,
            scenarioId: run.scenarioId,
          }),
        ),
      );
      cancelledCount += results.filter((r) => r.cancelled).length;
    }

    logger.info(
      { projectId, batchRunId, cancelledCount, skippedCount },
      "Batch run cancellation complete",
    );

    return { cancelledCount, skippedCount };
  }
}
