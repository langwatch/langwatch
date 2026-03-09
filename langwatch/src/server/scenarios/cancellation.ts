/**
 * Scenario run cancellation logic.
 *
 * Pure functions for determining cancellation eligibility and
 * service-level operations for cancelling individual and batch runs.
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import type { Job, Queue } from "bullmq";
import { createLogger } from "~/utils/logger/server";
import { ScenarioEventType, ScenarioRunStatus, Verdict } from "./scenario-event.enums";
import type { SimulationService } from "~/server/simulations/simulation.service";

const logger = createLogger("langwatch:scenarios:cancellation");

/** Statuses that are eligible for cancellation (still in-flight). */
const CANCELLABLE_STATUSES = new Set<ScenarioRunStatus>([
  ScenarioRunStatus.PENDING,
  ScenarioRunStatus.IN_PROGRESS,
  ScenarioRunStatus.STALLED,
]);

/** BullMQ job states that represent terminal jobs (not cancellable). */
const TERMINAL_BULLMQ_STATES = new Set(["completed", "failed"]);

/**
 * Determines whether a scenario run with the given status can be cancelled.
 *
 * Only in-flight statuses (PENDING, IN_PROGRESS, STALLED) are cancellable.
 * Terminal statuses (SUCCESS, FAILED, ERROR, CANCELLED) are not.
 *
 * @param status - The current status of the scenario run
 * @returns true if the run is eligible for cancellation
 */
export function isCancellableStatus(status: ScenarioRunStatus): boolean {
  return CANCELLABLE_STATUSES.has(status);
}

/** Parameters for cancelling a single scenario job. */
export interface CancelJobParams {
  projectId: string;
  jobId: string;
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
  queue: Pick<Queue, "getJob">;
  simulationService: Pick<SimulationService, "saveScenarioEvent" | "getRunDataForBatchRun">;
}

/**
 * Service responsible for cancelling scenario runs.
 *
 * Handles both individual job cancellation and batch-level cancellation.
 * Coordinates between BullMQ (queue) and event persistence (ES/ClickHouse).
 */
export class ScenarioCancellationService {
  private readonly queue: Pick<Queue, "getJob">;
  private readonly simulationService: Pick<SimulationService, "saveScenarioEvent" | "getRunDataForBatchRun">;

  constructor(deps: CancellationServiceDeps) {
    this.queue = deps.queue;
    this.simulationService = deps.simulationService;
  }

  /**
   * Cancel a single scenario job.
   *
   * - If the job is queued (waiting/delayed): removes it from BullMQ
   * - If the job is active (running): moves it to failed in BullMQ
   * - If the job is already completed/failed: does nothing (idempotent)
   * - If the BullMQ job doesn't exist: still persists cancellation event
   *
   * @returns { cancelled: true } if the job was cancelled, { cancelled: false } if already terminal
   */
  async cancelJob(params: CancelJobParams): Promise<CancelJobResult> {
    const { projectId, jobId, scenarioSetId, batchRunId, scenarioRunId, scenarioId } = params;

    logger.info({ projectId, jobId, batchRunId }, "Cancelling scenario job");

    const bullmqJob = await this.queue.getJob(jobId);

    if (bullmqJob) {
      const state = await (bullmqJob as Job).getState();

      // Terminal states: do not modify
      if (TERMINAL_BULLMQ_STATES.has(state)) {
        logger.debug({ jobId, state }, "Job already in terminal state, skipping cancellation");
        return { cancelled: false };
      }

      // Active: move to failed
      if (state === "active") {
        await (bullmqJob as Job).moveToFailed(
          new Error("Cancelled by user"),
          "0",
          false,
        );
        logger.info({ jobId }, "Active job moved to failed (cancelled)");
      } else {
        // Waiting/delayed: remove from queue
        await (bullmqJob as Job).remove();
        logger.info({ jobId, state }, "Job removed from queue (cancelled)");
      }
    } else {
      logger.debug({ jobId }, "BullMQ job not found, persisting cancellation event only");
    }

    // Persist the CANCELLED status as a RUN_FINISHED event
    await this.persistCancellationEvent({
      projectId,
      scenarioId,
      scenarioRunId,
      batchRunId,
      scenarioSetId,
    });

    return { cancelled: true };
  }

  /**
   * Cancel all remaining (non-terminal) jobs in a batch run.
   *
   * Fetches current run data, filters to cancellable runs, and cancels each
   * in parallel chunks (concurrency limit of 10).
   * Completed/failed/cancelled jobs are left untouched.
   */
  async cancelBatchRun(params: CancelBatchRunParams): Promise<CancelBatchRunResult> {
    const { projectId, scenarioSetId, batchRunId } = params;

    logger.info({ projectId, scenarioSetId, batchRunId }, "Cancelling batch run");

    const batchData = await this.simulationService.getRunDataForBatchRun({
      projectId,
      scenarioSetId,
      batchRunId,
    });

    if (!batchData.changed || batchData.runs.length === 0) {
      return { cancelledCount: 0, skippedCount: 0 };
    }

    const cancellableRuns = batchData.runs.filter((run) =>
      isCancellableStatus(run.status as ScenarioRunStatus),
    );
    const skippedCount = batchData.runs.length - cancellableRuns.length;

    // Cancel in parallel with concurrency limit
    const CONCURRENCY = 10;
    for (let i = 0; i < cancellableRuns.length; i += CONCURRENCY) {
      const chunk = cancellableRuns.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map((run) =>
          this.persistCancellationEvent({
            projectId,
            scenarioId: run.scenarioId,
            scenarioRunId: run.scenarioRunId,
            batchRunId: run.batchRunId,
            scenarioSetId,
          }),
        ),
      );
    }

    const cancelledCount = cancellableRuns.length;

    logger.info(
      { projectId, batchRunId, cancelledCount, skippedCount },
      "Batch run cancellation complete",
    );

    return { cancelledCount, skippedCount };
  }

  /**
   * Persists a RUN_FINISHED event with CANCELLED status.
   */
  private async persistCancellationEvent({
    projectId,
    scenarioId,
    scenarioRunId,
    batchRunId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioId: string;
    scenarioRunId: string;
    batchRunId: string;
    scenarioSetId: string;
  }): Promise<void> {
    await this.simulationService.saveScenarioEvent({
      projectId,
      type: ScenarioEventType.RUN_FINISHED,
      scenarioId,
      scenarioRunId,
      batchRunId,
      scenarioSetId,
      timestamp: Date.now(),
      status: ScenarioRunStatus.CANCELLED,
      results: {
        verdict: Verdict.INCONCLUSIVE,
        reasoning: "Cancelled by user",
        metCriteria: [],
        unmetCriteria: [],
      },
    });
  }
}
