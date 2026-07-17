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
} from "../schemas/events";
import {
  TopicClusteringRequestedEventSchema,
  TopicClusteringRunCompletedEventSchema,
  TopicClusteringRunFailedEventSchema,
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
  LastRunTracesProcessed: number;
  LastRunTopicsCount: number;
  LastRunSubtopicsCount: number;
  LastRunPages: number;
  InProgressRunId: string | null;
  InProgressTraces: number;
  InProgressPages: number;
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

const topicClusteringEvents = [
  TopicClusteringRequestedEventSchema,
  TopicClusteringRunCompletedEventSchema,
  TopicClusteringRunFailedEventSchema,
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
      LastRunTracesProcessed: 0,
      LastRunTopicsCount: 0,
      LastRunSubtopicsCount: 0,
      LastRunPages: 0,
      InProgressRunId: null,
      InProgressTraces: 0,
      InProgressPages: 0,
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
      LastRunTracesProcessed: tracesSoFar,
      LastRunTopicsCount: data.topicsCount,
      LastRunSubtopicsCount: data.subtopicsCount,
      LastRunPages: pagesSoFar,
      InProgressRunId: null,
      InProgressTraces: 0,
      InProgressPages: 0,
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
      LastRunSkippedReason: null,
      InProgressRunId: null,
      InProgressTraces: 0,
      InProgressPages: 0,
    };
  }
}
