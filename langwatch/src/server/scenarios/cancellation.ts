/**
 * Scenario run cancellation logic.
 *
 * Uses event-sourcing for cancellation: dispatches cancel_requested events
 * which are processed by the pipeline (fold projection + reactor). The
 * reactor broadcasts to all workers via Redis pub/sub. Each worker checks
 * if it owns the scenario and kills its child process.
 *
 * - Active jobs: killed by the worker that owns the child process
 * - Queued jobs: cancelled immediately via finished(CANCELLED) event
 *   (no worker will ever execute them)
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { createLogger } from "~/utils/logger/server";
import { ScenarioRunStatus, isCancellableStatus } from "./scenario-event.enums";
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
  getRunsForBatch: (params: { projectId: string; scenarioSetId: string; batchRunId: string }) => Promise<ScenarioRunData[]>;
  /** Dispatch a cancel_requested event via the event-sourcing pipeline. */
  dispatchCancelRequested: (params: { tenantId: string; scenarioRunId: string; occurredAt: number }) => Promise<void>;
  /** Dispatch a finished event with CANCELLED status. Used for queued jobs that no worker will pick up. */
  dispatchFinishRun: (params: { tenantId: string; scenarioRunId: string; status: string; occurredAt: number }) => Promise<void>;
}

/** Statuses that are queued but not yet picked up by a worker. */
const QUEUED_STATUSES = new Set<string>([
  ScenarioRunStatus.QUEUED,
  ScenarioRunStatus.PENDING,
]);

/**
 * Service responsible for cancelling scenario runs via event-sourcing.
 *
 * Dispatches cancel_requested events. The pipeline reactor broadcasts
 * to workers, and the worker owning the scenario kills its child process.
 */
export class ScenarioCancellationService {
  private readonly getRunsForBatch: CancellationServiceDeps["getRunsForBatch"];
  private readonly dispatchCancelRequested: CancellationServiceDeps["dispatchCancelRequested"];
  private readonly dispatchFinishRun: CancellationServiceDeps["dispatchFinishRun"];

  constructor(deps: CancellationServiceDeps) {
    this.getRunsForBatch = deps.getRunsForBatch;
    this.dispatchCancelRequested = deps.dispatchCancelRequested;
    this.dispatchFinishRun = deps.dispatchFinishRun;
  }

  /**
   * Cancel a single scenario run.
   *
   * 1. Check fold projection — if already terminal, skip
   * 2. Dispatch cancel_requested event (always — sets flag + triggers reactor broadcast)
   * 3. If queued/pending, also dispatch finished(CANCELLED) — no worker will ever act
   */
  async cancelJob(params: CancelJobParams): Promise<CancelJobResult> {
    const { projectId, scenarioRunId, batchRunId, scenarioSetId } = params;

    logger.info({ projectId, scenarioRunId, batchRunId }, "Cancelling scenario job");

    // Check current status from fold projection — if already terminal, skip
    const runs = await this.getRunsForBatch({ projectId, scenarioSetId, batchRunId });
    const run = runs.find((r) => r.scenarioRunId === scenarioRunId);
    if (run && !isCancellableStatus(run.status)) {
      logger.debug({ scenarioRunId, status: run.status }, "Run already terminal, nothing to cancel");
      return { cancelled: false };
    }

    const now = Date.now();

    // Dispatch cancel_requested event — reactor will broadcast to all workers
    await this.dispatchCancelRequested({
      tenantId: projectId,
      scenarioRunId,
      occurredAt: now,
    });

    // For queued/pending jobs that haven't been picked up yet, also write
    // the terminal event immediately — no worker will ever execute them
    if (run && QUEUED_STATUSES.has(run.status)) {
      await this.dispatchFinishRun({
        tenantId: projectId,
        scenarioRunId,
        status: ScenarioRunStatus.CANCELLED,
        occurredAt: now + 1, // +1ms to ensure ordering after cancel_requested
      });
    }

    logger.info({ projectId, scenarioRunId, status: run?.status }, "Cancellation event dispatched");
    return { cancelled: true };
  }

  /**
   * Cancel all remaining (non-terminal) jobs in a batch run.
   *
   * Reads run state from fold projections and cancels each cancellable run.
   */
  async cancelBatchRun(params: CancelBatchRunParams): Promise<CancelBatchRunResult> {
    const { projectId, scenarioSetId, batchRunId } = params;

    logger.info({ projectId, scenarioSetId, batchRunId }, "Cancelling batch run");

    const runs = await this.getRunsForBatch({ projectId, scenarioSetId, batchRunId });

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
