import { TOPIC_CLUSTERING_STALE_RUN_MS } from "./process-manager/topicClusteringProcess.definition";
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
  /**
   * Best available evidence that a run is underway right now.
   *
   * It is INFERRED, not read: the pipeline has no `run_started` event, so
   * nothing is written when a run begins. The projection's in-progress marker
   * (`inProgress`) is only written when a page reports that more pages remain,
   * so a project small enough to cluster in a single page never sets it, and
   * even a large project does not set it until its first page finishes. The
   * only other trace a running run leaves behind is its request: a request
   * with no outcome recorded after it means the run it asked for has not
   * reported back yet.
   *
   * Bounded by the same window the scheduler uses to abandon a run, so a
   * request whose run died without ever recording an outcome stops reading as
   * "running" at the same moment a new request would preempt it, rather than
   * pinning the UI to "Running" forever.
   *
   * Scheduled runs are started by the scheduler itself and record no request,
   * so their first page is invisible here; from the second page on
   * `inProgress` covers them.
   */
  runInFlight: boolean;
  /** Epoch ms of the next scheduled daily run, or null when unscheduled. */
  nextRunAt: number | null;
}

/** Serves the settings page's clustering status read (ADR-051 §7). */
export class TopicClusteringStatusService {
  constructor(
    private readonly repository: TopicClusteringStatusRepository,
    private readonly now: () => number = Date.now,
  ) {}

  async getByProjectId(params: {
    projectId: string;
  }): Promise<TopicClusteringStatus> {
    const { projection, nextWakeAt } =
      await this.repository.findByProjectId(params);

    const lastRequestedAt = projection?.LastRequestedAt ?? null;
    const lastRunAt = projection?.LastRunAt ?? null;
    const inProgress = projection?.InProgressRunId != null;

    return {
      lastRequestedAt,
      lastRequestTrigger: projection?.LastRequestTrigger ?? null,
      lastRunAt,
      lastRunOutcome: projection?.LastRunOutcome ?? null,
      lastRunMode: projection?.LastRunMode ?? null,
      lastRunSkippedReason: projection?.LastRunSkippedReason ?? null,
      lastRunErrorCode: projection?.LastRunErrorCode ?? null,
      lastRunErrorUserActionable:
        projection?.LastRunErrorUserActionable ?? false,
      lastRunTracesProcessed: projection?.LastRunTracesProcessed ?? 0,
      lastRunTopicsCount: projection?.LastRunTopicsCount ?? 0,
      lastRunSubtopicsCount: projection?.LastRunSubtopicsCount ?? 0,
      inProgress,
      runInFlight:
        inProgress || this.hasUnansweredRequest({ lastRequestedAt, lastRunAt }),
      nextRunAt: nextWakeAt?.getTime() ?? null,
    };
  }

  /**
   * Whether asking for a run right now would be answered by one already
   * underway rather than starting a new one. Same signal the settings page
   * renders, so the button and the badge can never disagree.
   */
  async isRunInFlight(params: { projectId: string }): Promise<boolean> {
    const status = await this.getByProjectId(params);
    return status.runInFlight;
  }

  private hasUnansweredRequest(params: {
    lastRequestedAt: number | null;
    lastRunAt: number | null;
  }): boolean {
    const { lastRequestedAt, lastRunAt } = params;
    if (lastRequestedAt === null) return false;
    if (lastRunAt !== null && lastRunAt >= lastRequestedAt) return false;
    return this.now() - lastRequestedAt < TOPIC_CLUSTERING_STALE_RUN_MS;
  }
}
