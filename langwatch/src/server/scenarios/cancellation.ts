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
import type { ScenarioJob } from "./scenario.queue";

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
  queue: Pick<Queue, "getJob" | "getJobs">;
  simulationService: Pick<SimulationService, "saveScenarioEvent" | "getRunDataForBatchRun">;
}

/** Error thrown when a job belongs to a different project than the request. */
export class CrossProjectAuthorizationError extends Error {
  constructor(jobId: string) {
    super(`Job ${jobId} does not belong to the requested project`);
    this.name = "CrossProjectAuthorizationError";
  }
}

/**
 * Service responsible for cancelling scenario runs.
 *
 * Handles both individual job cancellation and batch-level cancellation.
 * Coordinates between BullMQ (queue) and event persistence (ES/ClickHouse).
 */
export class ScenarioCancellationService {
  private readonly queue: Pick<Queue, "getJob" | "getJobs">;
  private readonly simulationService: Pick<SimulationService, "saveScenarioEvent" | "getRunDataForBatchRun">;

  constructor(deps: CancellationServiceDeps) {
    this.queue = deps.queue;
    this.simulationService = deps.simulationService;
  }

  /**
   * Cancel a single scenario job.
   *
   * - Verifies the BullMQ job belongs to the same project (cross-project auth)
   * - If the job is queued (waiting/delayed): removes it from BullMQ
   * - If the job is active (running): moves it to failed in BullMQ
   * - If the job is already completed/failed: does nothing (idempotent)
   * - If the BullMQ job doesn't exist: still persists cancellation event
   * - Uses try-catch around BullMQ operations for race condition safety
   *
   * @throws CrossProjectAuthorizationError if the job belongs to a different project
   * @returns { cancelled: true } if the job was cancelled, { cancelled: false } if already terminal
   */
  async cancelJob(params: CancelJobParams): Promise<CancelJobResult> {
    const { projectId, jobId, scenarioSetId, batchRunId, scenarioRunId, scenarioId } = params;

    logger.info({ projectId, jobId, batchRunId }, "Cancelling scenario job");

    const bullmqJob = await this.queue.getJob(jobId);

    if (bullmqJob) {
      // Cross-project authorization: verify the job belongs to this project
      const jobData = (bullmqJob as Job<ScenarioJob>).data;
      if (jobData?.projectId && jobData.projectId !== projectId) {
        throw new CrossProjectAuthorizationError(jobId);
      }

      const state = await (bullmqJob as Job).getState();

      // Terminal states: do not modify
      if (TERMINAL_BULLMQ_STATES.has(state)) {
        logger.debug({ jobId, state }, "Job already in terminal state, skipping cancellation");
        return { cancelled: false };
      }

      // Use try-catch for race condition safety: the job may transition
      // between getState() and the actual operation
      try {
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
      } catch (error) {
        // Job may have transitioned between getState() and the operation.
        // Log the race condition but still persist the cancellation event.
        logger.warn(
          { jobId, state, error },
          "BullMQ operation failed (likely race condition), persisting cancellation event anyway",
        );
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
   * Fetches current run data and BullMQ jobs in parallel, filters to
   * cancellable runs, and cancels each (both BullMQ and event persistence)
   * in parallel chunks (concurrency limit of 10).
   * Completed/failed/cancelled jobs are left untouched.
   */
  async cancelBatchRun(params: CancelBatchRunParams): Promise<CancelBatchRunResult> {
    const { projectId, scenarioSetId, batchRunId } = params;

    logger.info({ projectId, scenarioSetId, batchRunId }, "Cancelling batch run");

    // Fetch run data and BullMQ jobs in parallel
    const [batchData, waitingJobs, activeJobs] = await Promise.all([
      this.simulationService.getRunDataForBatchRun({
        projectId,
        scenarioSetId,
        batchRunId,
      }),
      this.getJobsSafe("waiting"),
      this.getJobsSafe("active"),
    ]);

    if (!batchData.changed || batchData.runs.length === 0) {
      return { cancelledCount: 0, skippedCount: 0 };
    }

    // Build a map of BullMQ jobs keyed by batchRunId for quick lookup
    const bullmqJobsByBatchRunId = new Map<string, Job<ScenarioJob>[]>();
    for (const job of [...waitingJobs, ...activeJobs]) {
      const typedJob = job as Job<ScenarioJob>;
      const jobBatchRunId = typedJob.data?.batchRunId;
      if (jobBatchRunId) {
        const existing = bullmqJobsByBatchRunId.get(jobBatchRunId) ?? [];
        existing.push(typedJob);
        bullmqJobsByBatchRunId.set(jobBatchRunId, existing);
      }
    }

    const batchBullmqJobs = bullmqJobsByBatchRunId.get(batchRunId) ?? [];

    const cancellableRuns = batchData.runs.filter((run) =>
      isCancellableStatus(run.status as ScenarioRunStatus),
    );
    const skippedCount = batchData.runs.length - cancellableRuns.length;

    // Cancel BullMQ jobs for this batch
    await this.cancelBullmqJobs(batchBullmqJobs);

    // Persist cancellation events in parallel with concurrency limit
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
   * Safely gets jobs by state from BullMQ, returning empty array on failure.
   */
  private async getJobsSafe(state: "waiting" | "active"): Promise<Job[]> {
    try {
      return await this.queue.getJobs([state]);
    } catch (error) {
      logger.warn({ error, state }, "Failed to get BullMQ jobs by state");
      return [];
    }
  }

  /**
   * Cancels BullMQ jobs: removes waiting jobs, moves active jobs to failed.
   * Uses try-catch per job for race condition safety.
   */
  private async cancelBullmqJobs(jobs: Job<ScenarioJob>[]): Promise<void> {
    await Promise.all(
      jobs.map(async (job) => {
        try {
          const state = await job.getState();
          if (TERMINAL_BULLMQ_STATES.has(state)) return;

          if (state === "active") {
            await job.moveToFailed(new Error("Cancelled by user"), "0", false);
            logger.info({ jobId: job.id }, "Batch cancel: active job moved to failed");
          } else {
            await job.remove();
            logger.info({ jobId: job.id, state }, "Batch cancel: job removed from queue");
          }
        } catch (error) {
          logger.warn(
            { jobId: job.id, error },
            "Batch cancel: BullMQ operation failed (likely race condition)",
          );
        }
      }),
    );
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
