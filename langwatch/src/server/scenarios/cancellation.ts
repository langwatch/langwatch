/**
 * Scenario run cancellation logic.
 *
 * Cancellation is primarily a BullMQ operation:
 * - Active jobs: worker handles cancellation via AbortSignal and writes events to ES.
 * - Queued jobs: removed from BullMQ + a CANCELLED event written to ES (since no
 *   worker will ever run for these, the API is the only one that can write the event).
 *
 * @see specs/features/suites/cancel-queued-running-jobs.feature
 */

import type { Job, Queue } from "bullmq";
import { createLogger } from "~/utils/logger/server";
import { ScenarioEventType, ScenarioRunStatus, isCancellableStatus } from "./scenario-event.enums";
export { isCancellableStatus };
import type { CancellationMessage } from "./cancellation-channel";

const logger = createLogger("langwatch:scenarios:cancellation");

/** BullMQ job states that represent terminal jobs (not cancellable). */
const TERMINAL_BULLMQ_STATES = new Set(["completed", "failed"]);

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
  queue: Pick<Queue, "getJob" | "getJobs">;
  /** Publishes a cancel signal to all worker instances via Redis pub/sub. Returns false when Redis is unavailable. */
  publishCancellation: (message: CancellationMessage) => Promise<boolean>;
  /** Fetches queued/active jobs from BullMQ for a given set + project. */
  getQueuedJobs: (params: { setId: string; projectId: string }) => Promise<Array<{ scenarioRunId: string; scenarioId: string; batchRunId: string; status: string }>>;
  /** Writes a scenario event to ES. Only used for queued jobs that will never be processed by a worker. */
  saveScenarioEvent: (event: CancellationEventParams) => Promise<void>;
}

/**
 * Service responsible for cancelling scenario runs.
 *
 * Handles both individual job cancellation and batch-level cancellation.
 * Cancellation is BullMQ-only: queued jobs are removed, active jobs receive
 * a cancel signal via Redis pub/sub, and terminal jobs are no-ops.
 */
export class ScenarioCancellationService {
  private readonly queue: Pick<Queue, "getJob">;
  private readonly publishCancellation: (message: CancellationMessage) => Promise<boolean>;
  private readonly getQueuedJobs: CancellationServiceDeps["getQueuedJobs"];
  private readonly saveScenarioEvent: CancellationServiceDeps["saveScenarioEvent"];

  constructor(deps: CancellationServiceDeps) {
    this.queue = deps.queue;
    this.publishCancellation = deps.publishCancellation;
    this.getQueuedJobs = deps.getQueuedJobs;
    this.saveScenarioEvent = deps.saveScenarioEvent;
  }

  /**
   * Cancel a single scenario job.
   *
   * - If the job is queued (waiting/delayed): removes it from BullMQ
   * - If the job is active (running): publishes cancel signal via Redis pub/sub
   * - If the job is already completed/failed: no-op
   * - If the BullMQ job doesn't exist: no-op
   *
   * @returns { cancelled: true } if the job was cancelled, { cancelled: false } if terminal or not found
   */
  async cancelJob(params: CancelJobParams): Promise<CancelJobResult> {
    const { projectId, jobId, batchRunId, scenarioRunId } = params;

    logger.info({ projectId, jobId, scenarioRunId, batchRunId }, "Cancelling scenario job");

    // Try direct lookup first, then search by scenarioRunId in job data.
    // The jobId from the frontend may be a scenarioRunId (not the BullMQ job ID).
    let bullmqJob = await this.queue.getJob(jobId);

    if (!bullmqJob) {
      // Search active/waiting/delayed jobs for matching scenarioRunId
      const allJobs = await this.queue.getJobs(["waiting", "active", "delayed"]);
      bullmqJob = allJobs.find((j) => {
        const data = j.data as Record<string, unknown> | undefined;
        return data?.scenarioRunId === scenarioRunId;
      }) ?? null;
    }

    if (!bullmqJob) {
      logger.debug({ jobId, scenarioRunId }, "BullMQ job not found, nothing to cancel");
      return { cancelled: false };
    }

    const state = await (bullmqJob as Job).getState();

    if (TERMINAL_BULLMQ_STATES.has(state)) {
      logger.debug({ jobId, state }, "BullMQ job in terminal state, nothing to cancel");
      return { cancelled: false };
    }

    if (state === "active") {
      const published = await this.publishCancellation({ jobId, projectId, scenarioRunId, batchRunId });
      if (!published) {
        logger.warn({ jobId }, "Cannot cancel active job: Redis unavailable");
        return { cancelled: false };
      }
      logger.info({ jobId }, "Cancellation signal published for active job");
      return { cancelled: true };
    }

    // Waiting/delayed: remove from queue and write cancellation event to ES.
    // No worker will ever run for this job, so the API must write the event.
    try {
      await (bullmqJob as Job).remove();
      logger.info({ jobId, state }, "Job removed from queue (cancelled)");
    } catch (err) {
      logger.warn({ jobId, state, err }, "Failed to remove queued job");
    }

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

    return { cancelled: true };
  }

  /**
   * Cancel all remaining (non-terminal) jobs in a batch run.
   *
   * Uses BullMQ as the sole source of truth for which jobs to cancel.
   * Completed/failed/cancelled jobs are left untouched.
   */
  async cancelBatchRun(params: CancelBatchRunParams): Promise<CancelBatchRunResult> {
    const { projectId, scenarioSetId, batchRunId } = params;

    logger.info({ projectId, scenarioSetId, batchRunId }, "Cancelling batch run");

    const queuedJobs = await this.getQueuedJobs({ setId: scenarioSetId, projectId });

    // Filter to jobs belonging to this batch run
    const batchJobs = queuedJobs.filter((job) => job.batchRunId === batchRunId);

    if (batchJobs.length === 0) {
      return { cancelledCount: 0, skippedCount: 0 };
    }

    const cancellableRuns = batchJobs.filter((run) =>
      isCancellableStatus(run.status as Parameters<typeof isCancellableStatus>[0]),
    );
    const skippedCount = batchJobs.length - cancellableRuns.length;

    // Cancel in parallel with concurrency limit
    const CONCURRENCY = 10;
    for (let i = 0; i < cancellableRuns.length; i += CONCURRENCY) {
      const chunk = cancellableRuns.slice(i, i + CONCURRENCY);
      await Promise.all(
        chunk.map((run) =>
          this.cancelJob({
            projectId,
            jobId: run.scenarioRunId,
            scenarioSetId,
            batchRunId: run.batchRunId,
            scenarioRunId: run.scenarioRunId,
            scenarioId: run.scenarioId,
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
}
