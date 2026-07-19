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
  /**
   * A run is working right now, as recorded by `run_started`. The effect
   * announces every page before working it, so this covers scheduled and
   * manual runs alike, from the first page, including runs that finish in a
   * single page. Cleared by the terminal `run_completed` / `run_failed` —
   * and, because that terminal write is best-effort and can be lost, ALSO
   * bounded by the scheduler's stale-run window from the run's start. An
   * unbounded read here pinned the badge to "Running" and made the route
   * refuse "Run now" until the next daily wake, even though the process
   * itself would have preempted the dead run.
   */
  inProgress: boolean;
  /**
   * Whether a run is underway, including one that has been asked for but has
   * not reached the effect yet.
   *
   * `inProgress` is the recorded fact and covers a run from the moment it
   * starts working. It cannot cover the gap BEFORE that: a manual request is
   * committed as an event, the process turns it into an intent, and the
   * outbox dispatches it — usually seconds, but longer under a backlog. In
   * that gap the only evidence is the request itself, so a request with no
   * outcome after it still reads as in-flight.
   *
   * That inference is bounded by the same window the scheduler uses to
   * abandon a run, so a request whose run died before announcing itself stops
   * reading as "running" at the moment a new request would preempt it,
   * instead of pinning the UI to "Running" forever.
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
    const inProgress =
      projection?.InProgressRunId != null &&
      this.now() -
        // Rows folded before the column existed fall back to the latest
        // applied event's business time — later than the true start, so the
        // bound only ever errs toward "still running" for one extra window.
        (projection.InProgressStartedAt ?? projection.OccurredAt) <
        TOPIC_CLUSTERING_STALE_RUN_MS;

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
