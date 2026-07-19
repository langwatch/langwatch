import type { TopicClusteringStatusRepository } from "./repositories/topic-clustering-status.repository";

export interface TopicClusteringStatus {
  lastRequestedAt: number | null;
  lastRequestTrigger: string | null;
  lastRunAt: number | null;
  /** completed | skipped | failed */
  lastRunOutcome: string | null;
  lastRunMode: string | null;
  lastRunSkippedReason: string | null;
  /**
   * Deliberately absent: the raw error text. It is a provider/langevals
   * response body — Python tracebacks, internal hostnames, echoed key
   * prefixes — and gating its release on a regex classifier means one
   * mis-scoped pattern turns into a disclosure. `lastRunErrorCode` is the
   * whole contract with the UI; fixed copy is chosen from it. The raw text
   * stays in the projection for operators. See ADR-051 §8.
   */
  lastRunErrorCode: string | null;
  /** True when the customer can resolve the failure themselves. */
  lastRunErrorUserActionable: boolean;
  lastRunTracesProcessed: number;
  lastRunTopicsCount: number;
  lastRunSubtopicsCount: number;
  /** A backlog walk is currently between pages. */
  inProgress: boolean;
  /** Epoch ms of the next scheduled daily run, or null when unscheduled. */
  nextRunAt: number | null;
}

/** Serves the settings page's clustering status read (ADR-051 §7). */
export class TopicClusteringStatusService {
  constructor(private readonly repository: TopicClusteringStatusRepository) {}

  async getByProjectId(params: {
    projectId: string;
  }): Promise<TopicClusteringStatus> {
    const { projection, nextWakeAt } = await this.repository.findByProjectId(
      params,
    );
    return {
      lastRequestedAt: projection?.LastRequestedAt ?? null,
      lastRequestTrigger: projection?.LastRequestTrigger ?? null,
      lastRunAt: projection?.LastRunAt ?? null,
      lastRunOutcome: projection?.LastRunOutcome ?? null,
      lastRunMode: projection?.LastRunMode ?? null,
      lastRunSkippedReason: projection?.LastRunSkippedReason ?? null,
      lastRunErrorCode: projection?.LastRunErrorCode ?? null,
      lastRunErrorUserActionable:
        projection?.LastRunErrorUserActionable ?? false,
      lastRunTracesProcessed: projection?.LastRunTracesProcessed ?? 0,
      lastRunTopicsCount: projection?.LastRunTopicsCount ?? 0,
      lastRunSubtopicsCount: projection?.LastRunSubtopicsCount ?? 0,
      inProgress: projection?.InProgressRunId != null,
      nextRunAt: nextWakeAt?.getTime() ?? null,
    };
  }
}
