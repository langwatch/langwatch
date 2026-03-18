/**
 * ScenarioJobRepository
 *
 * Queries BullMQ for waiting/active jobs and normalizes them into
 * a format compatible with ScenarioRunData for unified table rendering.
 */

import { ScenarioRunStatus } from "./scenario-event.enums";
import type { ScenarioRunData } from "./scenario-event.types";
import type { ScenarioJob } from "./scenario.queue";
import { STALL_THRESHOLD_MS } from "./stall-detection";

/**
 * Maps BullMQ job state to ScenarioRunStatus.
 *
 * For active jobs, optionally checks whether the job has exceeded the stall
 * threshold based on its timestamp. This catches workers that died before
 * emitting a RUN_STARTED event.
 */
export function mapBullMQStateToStatus({
  state,
  jobTimestamp,
  now = Date.now(),
}: {
  state: string;
  jobTimestamp?: number;
  now?: number;
}): ScenarioRunStatus {
  switch (state) {
    case "active": {
      if (jobTimestamp !== undefined) {
        if (now - jobTimestamp >= STALL_THRESHOLD_MS) {
          return ScenarioRunStatus.STALLED;
        }
      }
      return ScenarioRunStatus.RUNNING;
    }
    case "completed":
      return ScenarioRunStatus.IN_PROGRESS;
    case "failed":
      return ScenarioRunStatus.ERROR;
    case "waiting":
    default:
      return ScenarioRunStatus.QUEUED;
  }
}

/** A minimal job shape compatible with BullMQ Job objects. */
export interface MinimalJob {
  id?: string | null;
  data: ScenarioJob;
  timestamp?: number;
  processedOn?: number;
}

/** Parameters for normalizing a single BullMQ job into a ScenarioRunData row. */
export interface NormalizeJobParams {
  job: MinimalJob;
  state: string;
}

/**
 * Normalizes a single BullMQ job into a ScenarioRunData-compatible row.
 *
 * Uses job data for identifiers and the BullMQ state for status mapping.
 * Returns null if the job has no data (defensive).
 */
export function normalizeJob({ job, state }: NormalizeJobParams): ScenarioRunData | null {
  const data = job.data;
  if (!data) return null;
  if (!data.scenarioId || !data.batchRunId || !data.target?.referenceId || !data.target?.type) {
    return null;
  }

  const status = mapBullMQStateToStatus({
    state,
    jobTimestamp: job.processedOn ?? job.timestamp,
  });

  return {
    scenarioId: data.scenarioId,
    batchRunId: data.batchRunId,
    // Prefer the pre-assigned scenarioRunId from job data (generated at queue time).
    // Fall back to BullMQ job ID as a stable placeholder for table rendering.
    scenarioRunId: data.scenarioRunId ?? job.id ?? `job_${data.scenarioId}_${data.batchRunId}`,
    name: data.scenarioName ?? null,
    description: null,
    metadata: {
      langwatch: {
        targetReferenceId: data.target.referenceId,
        targetType: data.target.type,
      },
    },
    status,
    results: null,
    messages: [],
    timestamp: job.timestamp ?? Date.now(),
    durationInMs: 0,
  };
}

/**
 * Interface for fetching jobs from the queue (enables testability).
 *
 * Uses a loose signature compatible with both BullMQ Queue.getJobs()
 * and test stubs. The return type uses `any` for the data to avoid
 * coupling to BullMQ's JobBase vs Job generics.
 */
export interface ScenarioQueueAdapter {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getJobs(states: any): Promise<Array<{ id?: string | null; data: any; timestamp?: number; processedOn?: number }>>;
}

type JobState = "waiting" | "active" | "completed" | "failed";

/** Priority order for state collapsing — higher index wins. */
const STATE_PRIORITY: Record<JobState, number> = {
  waiting: 0,
  active: 1,
  completed: 2,
  failed: 2,
};

/**
 * Collapses job lists by job ID to avoid transitional duplicates
 * when a job moves between states. Higher-priority state wins.
 */
function collapseJobsById(params: {
  jobsByState: Array<{ jobs: Array<{ id?: string | null; data: unknown; timestamp?: number; processedOn?: number }>; state: JobState }>;
}): Array<{ job: MinimalJob; state: JobState }> {
  const byId = new Map<string, { job: MinimalJob; state: JobState }>();

  for (const { jobs, state } of params.jobsByState) {
    for (const job of jobs) {
      const key = String(job.id ?? "");
      const existing = byId.get(key);
      if (!existing || STATE_PRIORITY[state] >= STATE_PRIORITY[existing.state]) {
        byId.set(key, { job: job as MinimalJob, state });
      }
    }
  }

  return [...byId.values()];
}

/**
 * Repository for querying BullMQ scenario jobs and normalizing them
 * into ScenarioRunData format.
 */
export class ScenarioJobRepository {
  constructor(private readonly queue: ScenarioQueueAdapter) {}

  /**
   * Fetches all jobs (waiting, active, completed, failed) for a given setId,
   * normalizes them into ScenarioRunData format.
   *
   * Includes completed/failed jobs so they remain visible during the gap
   * between BullMQ completion and ES indexing.
   */
  async getQueuedAndActiveJobs(params: {
    setId: string;
    projectId: string;
  }): Promise<ScenarioRunData[]> {
    const { setId, projectId } = params;

    const [waitingJobs, activeJobs, completedJobs, failedJobs] = await Promise.all([
      this.queue.getJobs(["waiting"]),
      this.queue.getJobs(["active"]),
      this.queue.getJobs(["completed"]),
      this.queue.getJobs(["failed"]),
    ]);

    const results: ScenarioRunData[] = [];

    for (const { job, state } of collapseJobsById({
      jobsByState: [
        { jobs: waitingJobs, state: "waiting" },
        { jobs: activeJobs, state: "active" },
        { jobs: completedJobs, state: "completed" },
        { jobs: failedJobs, state: "failed" },
      ],
    })) {
      if (job.data?.setId === setId && job.data?.projectId === projectId) {
        const normalized = normalizeJob({ job, state });
        if (normalized) results.push(normalized);
      }
    }

    return results;
  }

  /**
   * Fetches all jobs for a given projectId across all sets.
   * Returns both the normalized runs and a mapping of batchRunId to setId
   * for use in the All Runs cross-suite view.
   */
  async getAllQueuedJobsForProject(params: {
    projectId: string;
  }): Promise<{
    runs: ScenarioRunData[];
    scenarioSetIds: Record<string, string>;
  }> {
    const { projectId } = params;

    const [waitingJobs, activeJobs, completedJobs, failedJobs] = await Promise.all([
      this.queue.getJobs(["waiting"]),
      this.queue.getJobs(["active"]),
      this.queue.getJobs(["completed"]),
      this.queue.getJobs(["failed"]),
    ]);

    const runs: ScenarioRunData[] = [];
    const scenarioSetIds: Record<string, string> = {};

    for (const { job, state } of collapseJobsById({
      jobsByState: [
        { jobs: waitingJobs, state: "waiting" },
        { jobs: activeJobs, state: "active" },
        { jobs: completedJobs, state: "completed" },
        { jobs: failedJobs, state: "failed" },
      ],
    })) {
      if (job.data?.projectId !== projectId) continue;

      const normalized = normalizeJob({ job, state });
      if (normalized) {
        runs.push(normalized);
        if (job.data?.setId && job.data?.batchRunId) {
          scenarioSetIds[job.data.batchRunId] = job.data.setId;
        }
      }
    }

    return { runs, scenarioSetIds };
  }
}
