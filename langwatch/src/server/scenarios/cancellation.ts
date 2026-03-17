/**
 * Scenario run cancellation logic.
 *
 * Reads run state from fold projections (CH/ES via SimulationFacade).
 * Only removeQueuedJob and signalCancel are transport-specific (BullMQ today).
 *
 * - Active jobs: worker handles cancellation via AbortSignal and writes events to ES.
 * - Queued jobs: removed from execution queue + a CANCELLED event written to ES
 *   (since no worker will ever run for these, the API is the only writer).
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import { createLogger } from "~/utils/logger/server";
import { ScenarioEventType, ScenarioRunStatus, isCancellableStatus } from "./scenario-event.enums";
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
  /** "removed" = confirmed cancelled (queued job removed from queue).
   *  "signalled" = cancellation requested (active job, async — may not take effect if already completed).
   *  undefined when cancelled is false. */
  method?: "removed" | "signalled";
}

/** Result of cancelling a batch run. */
export interface CancelBatchRunResult {
  cancelledCount: number;
  skippedCount: number;
}

/** Minimal event shape for persisting cancellation of queued jobs. */
interface CancellationEventParams {
  projectId: string;
  type: ScenarioEventType.RUN_FINISHED;
  scenarioId: string;
  scenarioRunId: string;
  batchRunId: string;
  scenarioSetId: string;
  timestamp: number;
  status: ScenarioRunStatus.CANCELLED;
  results: null;
}

/** Dependencies injected into the cancellation service. */
export interface CancellationServiceDeps {
  /** Read run state from CH/ES fold projections. */
  getRunsForBatch: (params: { projectId: string; scenarioSetId: string; batchRunId: string }) => Promise<ScenarioRunData[]>;
  /** Remove a queued job from the execution queue (BullMQ today, GroupQueue later). Returns true if the job was found and removed. */
  removeQueuedJob: (params: { projectId: string; scenarioRunId: string }) => Promise<boolean>;
  /** Signal an active job to abort (Redis pub/sub). Returns true if the signal was published. */
  signalCancel: (params: { projectId: string; scenarioRunId: string; batchRunId: string }) => Promise<boolean>;
  /** Writes a scenario event to ES + CH. Only used for queued jobs that will never be processed by a worker. */
  saveScenarioEvent: (event: CancellationEventParams) => Promise<void>;
}

/**
 * Service responsible for cancelling scenario runs.
 *
 * Handles both individual job cancellation and batch-level cancellation.
 * Uses fold projections for state reads; only queue removal and cancel
 * signalling are transport-specific.
 */
export class ScenarioCancellationService {
  private readonly getRunsForBatch: CancellationServiceDeps["getRunsForBatch"];
  private readonly removeQueuedJob: CancellationServiceDeps["removeQueuedJob"];
  private readonly signalCancel: CancellationServiceDeps["signalCancel"];
  private readonly saveScenarioEvent: CancellationServiceDeps["saveScenarioEvent"];

  constructor(deps: CancellationServiceDeps) {
    this.getRunsForBatch = deps.getRunsForBatch;
    this.removeQueuedJob = deps.removeQueuedJob;
    this.signalCancel = deps.signalCancel;
    this.saveScenarioEvent = deps.saveScenarioEvent;
  }

  /**
   * Cancel a single scenario job.
   *
   * 1. Check fold projection — if already terminal, return early (no false positive)
   * 2. Try removing from queue — if it succeeds, the job was queued
   * 3. If removal fails, signal cancel — the job is likely active
   * 4. If both fail, the job is not found
   *
   * Only writes a CANCELLED event for removed (queued) jobs. Active jobs
   * have their status written by the worker's failure handler.
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

    // Try removing from queue (works for QUEUED/WAITING jobs)
    const removed = await this.removeQueuedJob({ projectId, scenarioRunId });
    if (removed) {
      logger.info({ scenarioRunId }, "Job removed from queue (cancelled)");

      // Job was queued — write CANCELLED since no worker will process it
      await this.saveScenarioEvent({
        projectId: params.projectId,
        type: ScenarioEventType.RUN_FINISHED,
        scenarioId: params.scenarioId,
        scenarioRunId: params.scenarioRunId,
        batchRunId: params.batchRunId,
        scenarioSetId: params.scenarioSetId,
        timestamp: Date.now(),
        status: ScenarioRunStatus.CANCELLED,
        results: null,
      });

      return { cancelled: true, method: "removed" };
    }

    // Try signaling cancel (works for ACTIVE/RUNNING jobs)
    const signalled = await this.signalCancel({ projectId, scenarioRunId, batchRunId });
    if (signalled) {
      logger.info({ scenarioRunId }, "Cancellation signal published for active job");
      return { cancelled: true, method: "signalled" };
    }

    // Neither worked — job is terminal or not found
    logger.debug({ scenarioRunId }, "Job not cancellable (terminal or not found)");
    return { cancelled: false };
  }

  /**
   * Cancel all remaining (non-terminal) jobs in a batch run.
   *
   * Reads run state from fold projections (CH/ES) and cancels each
   * cancellable run. Completed/failed/cancelled jobs are left untouched.
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
