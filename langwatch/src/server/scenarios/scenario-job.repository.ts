/**
 * ScenarioJobRepository
 *
 * Queries BullMQ for waiting/active jobs and normalizes them into
 * a format compatible with ScenarioRunData for unified table rendering.
 */

import { ScenarioRunStatus } from "./scenario-event.enums";
import type { ScenarioRunData } from "./scenario-event.types";
import type { ScenarioJob } from "./scenario.queue";

/** Maps BullMQ job state to ScenarioRunStatus. */
export function mapBullMQStateToStatus(
  state: string,
): ScenarioRunStatus.QUEUED | ScenarioRunStatus.RUNNING {
  switch (state) {
    case "active":
      return ScenarioRunStatus.RUNNING;
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

  const status = mapBullMQStateToStatus(state);

  return {
    scenarioId: data.scenarioId,
    batchRunId: data.batchRunId,
    // Queued jobs don't have a scenarioRunId yet (generated at execution time).
    // Use the BullMQ job ID as a stable placeholder for table rendering.
    scenarioRunId: job.id ?? `job_${data.scenarioId}_${data.batchRunId}`,
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
  getJobs(states: any): Promise<Array<{ id?: string | null; data: any; timestamp?: number }>>;
}

/**
 * Collapses waiting and active job lists by job ID to avoid
 * transitional duplicates when a job moves between states.
 * Active state overrides waiting.
 */
function collapseJobsById(params: {
  waitingJobs: Array<{ id?: string | null; data: unknown; timestamp?: number }>;
  activeJobs: Array<{ id?: string | null; data: unknown; timestamp?: number }>;
}): Array<{ job: MinimalJob; state: "waiting" | "active" }> {
  const { waitingJobs, activeJobs } = params;
  const byId = new Map<string, { job: MinimalJob; state: "waiting" | "active" }>();

  for (const job of waitingJobs) {
    const key = String(job.id ?? "");
    byId.set(key, { job: job as MinimalJob, state: "waiting" });
  }
  for (const job of activeJobs) {
    const key = String(job.id ?? "");
    byId.set(key, { job: job as MinimalJob, state: "active" }); // active wins
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
   * Fetches all waiting and active jobs for a given setId,
   * normalizes them into ScenarioRunData format.
   */
  async getQueuedAndActiveJobs(params: {
    setId: string;
    projectId: string;
  }): Promise<ScenarioRunData[]> {
    const { setId, projectId } = params;

    const [waitingJobs, activeJobs] = await Promise.all([
      this.queue.getJobs(["waiting"]),
      this.queue.getJobs(["active"]),
    ]);

    const results: ScenarioRunData[] = [];

    for (const { job, state } of collapseJobsById({ waitingJobs, activeJobs })) {
      if (job.data?.setId === setId && job.data?.projectId === projectId) {
        const normalized = normalizeJob({ job, state });
        if (normalized) results.push(normalized);
      }
    }

    return results;
  }

  /**
   * Fetches all waiting and active jobs for a given projectId across all sets.
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

    const [waitingJobs, activeJobs] = await Promise.all([
      this.queue.getJobs(["waiting"]),
      this.queue.getJobs(["active"]),
    ]);

    const runs: ScenarioRunData[] = [];
    const scenarioSetIds: Record<string, string> = {};

    for (const { job, state } of collapseJobsById({ waitingJobs, activeJobs })) {
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
