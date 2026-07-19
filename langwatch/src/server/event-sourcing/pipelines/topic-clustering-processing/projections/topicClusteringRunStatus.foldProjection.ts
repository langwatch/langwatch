import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  TOPIC_CLUSTERING_PROJECTION_VERSIONS,
  TOPIC_CLUSTERING_RUN_OUTCOME,
} from "../schemas/constants";
import type {
  TopicClusteringRequestedEvent,
  TopicClusteringRunCompletedEvent,
  TopicClusteringRunFailedEvent,
  TopicClusteringRunStartedEvent,
} from "../schemas/events";
import {
  TopicClusteringRequestedEventSchema,
  TopicClusteringRunCompletedEventSchema,
  TopicClusteringRunFailedEventSchema,
  TopicClusteringRunStartedEventSchema,
} from "../schemas/events";

/**
 * Per-project topic clustering run status (ADR-051 §1/§7): the public read
 * model behind the settings page. One row per project; the process manager's
 * private state is deliberately NOT readable by the UI — decisions read
 * process state, screens read this projection.
 *
 * State = stored data: one type, not two. A logical run spans pages (one
 * run_completed event per page, sharing runId); in-progress pages accumulate
 * in the InProgress* fields and roll into the Last* fields when the final
 * page (no nextSearchAfter) or a failure lands.
 */
export interface TopicClusteringRunStatusData {
  ProjectId: string;
  LastRequestedAt: number | null;
  LastRequestTrigger: string | null;
  LastRunAt: number | null;
  /** completed | skipped | failed */
  LastRunOutcome: string | null;
  LastRunMode: string | null;
  LastRunSkippedReason: string | null;
  LastRunError: string | null;
  LastRunErrorCode: string | null;
  /** True when the customer can resolve the failure themselves. */
  LastRunErrorUserActionable: boolean;
  LastRunTracesProcessed: number;
  LastRunTopicsCount: number;
  LastRunSubtopicsCount: number;
  LastRunPages: number;
  InProgressRunId: string | null;
  InProgressTraces: number;
  InProgressPages: number;
  /**
   * Business time the in-progress run opened (its first event), carried
   * unchanged across the run's pages — the projection-side mirror of the
   * process's `startedAtMs`, so the read model can stop reporting a run whose
   * terminal outcome write was lost on the SAME clock the scheduler uses to
   * abandon it.
   */
  InProgressStartedAt: number | null;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

const topicClusteringEvents = [
  TopicClusteringRequestedEventSchema,
  TopicClusteringRunCompletedEventSchema,
  TopicClusteringRunFailedEventSchema,
  TopicClusteringRunStartedEventSchema,
] as const;

export class TopicClusteringRunStatusFoldProjection
  extends AbstractFoldProjection<
    TopicClusteringRunStatusData,
    typeof topicClusteringEvents
  >
  implements
    FoldEventHandlers<
      typeof topicClusteringEvents,
      TopicClusteringRunStatusData
    >
{
  readonly name = "topicClusteringRunStatus";
  readonly version = TOPIC_CLUSTERING_PROJECTION_VERSIONS.RUN_STATUS;
  readonly store: StateProjectionStore<TopicClusteringRunStatusData>;

  protected readonly events = topicClusteringEvents;

  constructor(deps: {
    store: StateProjectionStore<TopicClusteringRunStatusData>;
  }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return {
      ProjectId: "",
      LastRequestedAt: null,
      LastRequestTrigger: null,
      LastRunAt: null,
      LastRunOutcome: null,
      LastRunMode: null,
      LastRunSkippedReason: null,
      LastRunError: null,
      LastRunErrorCode: null,
      LastRunErrorUserActionable: false,
      LastRunTracesProcessed: 0,
      LastRunTopicsCount: 0,
      LastRunSubtopicsCount: 0,
      LastRunPages: 0,
      InProgressRunId: null,
      InProgressTraces: 0,
      InProgressPages: 0,
      InProgressStartedAt: null,
    };
  }

  handleTopicClusteringRequested(
    event: TopicClusteringRequestedEvent,
    state: TopicClusteringRunStatusData,
  ): TopicClusteringRunStatusData {
    return {
      ...state,
      ProjectId: String(event.aggregateId),
      LastRequestedAt: event.occurredAt,
      LastRequestTrigger: event.data.trigger,
    };
  }

  handleTopicClusteringRunStarted(
    event: TopicClusteringRunStartedEvent,
    state: TopicClusteringRunStatusData,
  ): TopicClusteringRunStatusData {
    // Page 1 opens a run; later pages of the same run keep the counters the
    // completion handler has been accumulating. A start for a DIFFERENT run
    // supersedes whatever was recorded as in progress — the stale-run guard
    // has already decided the old one is gone.
    const sameRun = state.InProgressRunId === event.data.runId;
    return {
      ...state,
      ProjectId: String(event.aggregateId),
      InProgressRunId: event.data.runId,
      InProgressTraces: sameRun ? state.InProgressTraces : 0,
      InProgressPages: sameRun ? state.InProgressPages : 0,
      InProgressStartedAt: sameRun
        ? state.InProgressStartedAt
        : event.occurredAt,
    };
  }

  handleTopicClusteringRunCompleted(
    event: TopicClusteringRunCompletedEvent,
    state: TopicClusteringRunStatusData,
  ): TopicClusteringRunStatusData {
    const { data } = event;
    const sameRun = state.InProgressRunId === data.runId;
    const tracesSoFar =
      (sameRun ? state.InProgressTraces : 0) + data.tracesProcessed;
    const pagesSoFar = (sameRun ? state.InProgressPages : 0) + 1;

    if (data.nextSearchAfter) {
      return {
        ...state,
        ProjectId: String(event.aggregateId),
        InProgressRunId: data.runId,
        InProgressTraces: tracesSoFar,
        InProgressPages: pagesSoFar,
        // A completion can open a run the projection never saw start (the
        // best-effort run_started announcement was lost); date the run from
        // this first observed event, never restamping an already-open run.
        InProgressStartedAt: sameRun
          ? state.InProgressStartedAt
          : event.occurredAt,
      };
    }

    const skippedWithoutWork =
      data.skippedReason != null && tracesSoFar === 0;
    return {
      ...state,
      ProjectId: String(event.aggregateId),
      LastRunAt: event.occurredAt,
      LastRunOutcome: skippedWithoutWork
        ? TOPIC_CLUSTERING_RUN_OUTCOME.SKIPPED
        : TOPIC_CLUSTERING_RUN_OUTCOME.COMPLETED,
      LastRunMode: data.mode,
      LastRunSkippedReason: data.skippedReason ?? null,
      LastRunError: null,
      LastRunErrorCode: null,
      LastRunErrorUserActionable: false,
      LastRunTracesProcessed: tracesSoFar,
      LastRunTopicsCount: data.topicsCount,
      LastRunSubtopicsCount: data.subtopicsCount,
      LastRunPages: pagesSoFar,
      InProgressRunId: null,
      InProgressTraces: 0,
      InProgressPages: 0,
      InProgressStartedAt: null,
    };
  }

  handleTopicClusteringRunFailed(
    event: TopicClusteringRunFailedEvent,
    state: TopicClusteringRunStatusData,
  ): TopicClusteringRunStatusData {
    return {
      ...state,
      ProjectId: String(event.aggregateId),
      LastRunAt: event.occurredAt,
      LastRunOutcome: TOPIC_CLUSTERING_RUN_OUTCOME.FAILED,
      LastRunError: event.data.error,
      LastRunErrorCode: event.data.errorCode ?? null,
      LastRunErrorUserActionable: event.data.userActionable ?? false,
      LastRunSkippedReason: null,
      // A failed run produced no counts. Without these resets the row keeps the
      // PREVIOUS (successful) run's numbers, so the settings page renders a
      // failure alongside a healthy-looking "12,000 traces / 40 topics" — the
      // mirror image of the completed handler clearing the error fields.
      LastRunTracesProcessed: 0,
      LastRunTopicsCount: 0,
      LastRunSubtopicsCount: 0,
      LastRunPages: 0,
      // Same reasoning: a failed run clustered nothing, so it has no mode.
      // Leaving the previous run's mode attributed "Rebuilt all topics" to a
      // run that failed.
      LastRunMode: null,
      InProgressRunId: null,
      InProgressTraces: 0,
      InProgressPages: 0,
      InProgressStartedAt: null,
    };
  }
}
