import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  TOPIC_CLUSTERING_PROJECTION_VERSIONS,
  TOPIC_CLUSTERING_RUN_HISTORY_LIMIT,
  TOPIC_CLUSTERING_RUN_OUTCOME,
  TOPIC_CLUSTERING_TRIGGER,
} from "../schemas/constants";
import type {
  TopicClusteringRunCompletedEvent,
  TopicClusteringRunFailedEvent,
  TopicClusteringRunStartedEvent,
} from "../schemas/events";
import {
  TopicClusteringRunCompletedEventSchema,
  TopicClusteringRunFailedEventSchema,
  TopicClusteringRunStartedEventSchema,
} from "../schemas/events";

/**
 * One run in the project's history, accumulated across the run's pages.
 *
 * The raw error text is deliberately NOT part of this read model — the same
 * disclosure reasoning as the status service (ADR-051 §8): `errorCode` is
 * the whole contract with the UI, and the raw text stays in the run-status
 * projection for operators.
 */
export interface TopicClusteringRunHistoryEntry {
  runId: string;
  /** manual | bootstrap-scheduled runs both read as "scheduled" here. */
  trigger: string;
  /** Business time of the run's first observed event. */
  startedAt: number;
  /** Business time of the terminal event; null while running/abandoned. */
  finishedAt: number | null;
  /** running | completed | skipped | failed | abandoned */
  outcome: string;
  mode: string | null;
  skippedReason: string | null;
  errorCode: string | null;
  isErrorUserActionable: boolean;
  tracesProcessed: number;
  topicsCount: number;
  subtopicsCount: number;
  pages: number;
}

/**
 * Per-project run history (audit read model): the recent runs, newest first,
 * bounded to {@link TOPIC_CLUSTERING_RUN_HISTORY_LIMIT}. Stored as one row
 * per project; rebuildable by replaying the event log. A logical run spans
 * pages (one run_completed event per page, sharing runId) and appears as a
 * single entry whose counts accumulate every page.
 */
export interface TopicClusteringRunHistoryData {
  ProjectId: string;
  /** Newest first. */
  Runs: TopicClusteringRunHistoryEntry[];
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

const historyEvents = [
  TopicClusteringRunStartedEventSchema,
  TopicClusteringRunCompletedEventSchema,
  TopicClusteringRunFailedEventSchema,
] as const;

function runTrigger(runId: string): string {
  return runId.startsWith(`${TOPIC_CLUSTERING_TRIGGER.MANUAL}-`)
    ? TOPIC_CLUSTERING_TRIGGER.MANUAL
    : "scheduled";
}

function openEntry(params: {
  runId: string;
  startedAt: number;
}): TopicClusteringRunHistoryEntry {
  return {
    runId: params.runId,
    trigger: runTrigger(params.runId),
    startedAt: params.startedAt,
    finishedAt: null,
    outcome: TOPIC_CLUSTERING_RUN_OUTCOME.RUNNING,
    mode: null,
    skippedReason: null,
    errorCode: null,
    isErrorUserActionable: false,
    tracesProcessed: 0,
    topicsCount: 0,
    subtopicsCount: 0,
    pages: 0,
  };
}

/**
 * A new run superseding an unfinished one settles the old entry as abandoned
 * — its terminal outcome never arrived and never will (the scheduler's
 * stale-run guard has already moved on), so it must stop reading as running.
 */
function settleSuperseded(
  runs: TopicClusteringRunHistoryEntry[],
  liveRunId: string,
): TopicClusteringRunHistoryEntry[] {
  return runs.map((run) =>
    run.outcome === TOPIC_CLUSTERING_RUN_OUTCOME.RUNNING &&
    run.runId !== liveRunId
      ? { ...run, outcome: TOPIC_CLUSTERING_RUN_OUTCOME.ABANDONED }
      : run,
  );
}

/**
 * The entry for `runId`, opened on demand: a completion can reach the
 * projection for a run it never saw start (the run_started announcement is
 * best-effort), so date the run from the first observed event.
 */
function withRun(
  state: TopicClusteringRunHistoryData,
  params: { projectId: string; runId: string; occurredAt: number },
  update: (
    entry: TopicClusteringRunHistoryEntry,
  ) => TopicClusteringRunHistoryEntry,
): TopicClusteringRunHistoryData {
  const settled = settleSuperseded(state.Runs, params.runId);
  const index = settled.findIndex((run) => run.runId === params.runId);
  const runs =
    index === -1
      ? [
          update(
            openEntry({ runId: params.runId, startedAt: params.occurredAt }),
          ),
          ...settled,
        ]
      : settled.map((run, i) => (i === index ? update(run) : run));
  return {
    ...state,
    ProjectId: params.projectId,
    Runs: runs.slice(0, TOPIC_CLUSTERING_RUN_HISTORY_LIMIT),
  };
}

export class TopicClusteringRunHistoryFoldProjection
  extends AbstractFoldProjection<
    TopicClusteringRunHistoryData,
    typeof historyEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<TopicClusteringRunHistoryData>
  >
  implements
    FoldEventHandlers<typeof historyEvents, TopicClusteringRunHistoryData>
{
  readonly name = "topicClusteringRunHistory";
  readonly version = TOPIC_CLUSTERING_PROJECTION_VERSIONS.RUN_HISTORY;
  readonly store: StateProjectionStore<TopicClusteringRunHistoryData>;

  protected readonly events = historyEvents;

  constructor(deps: {
    store: StateProjectionStore<TopicClusteringRunHistoryData>;
  }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return {
      ProjectId: "",
      Runs: [],
    };
  }

  handleTopicClusteringRunStarted(
    event: TopicClusteringRunStartedEvent,
    state: TopicClusteringRunHistoryData,
  ): TopicClusteringRunHistoryData {
    // Every page announces itself; only the first observed announcement of a
    // run opens its entry, later pages leave the accumulating entry alone.
    return withRun(
      state,
      {
        projectId: String(event.aggregateId),
        runId: event.data.runId,
        occurredAt: event.occurredAt,
      },
      (entry) => entry,
    );
  }

  handleTopicClusteringRunCompleted(
    event: TopicClusteringRunCompletedEvent,
    state: TopicClusteringRunHistoryData,
  ): TopicClusteringRunHistoryData {
    const { data } = event;
    return withRun(
      state,
      {
        projectId: String(event.aggregateId),
        runId: data.runId,
        occurredAt: event.occurredAt,
      },
      (entry) => {
        const tracesProcessed = entry.tracesProcessed + data.tracesProcessed;
        const pages = entry.pages + 1;
        if (data.nextSearchAfter) {
          return {
            ...entry,
            outcome: TOPIC_CLUSTERING_RUN_OUTCOME.RUNNING,
            mode: data.mode,
            tracesProcessed,
            topicsCount: data.topicsCount,
            subtopicsCount: data.subtopicsCount,
            pages,
          };
        }
        const skippedWithoutWork =
          data.skippedReason != null && tracesProcessed === 0;
        return {
          ...entry,
          finishedAt: event.occurredAt,
          outcome: skippedWithoutWork
            ? TOPIC_CLUSTERING_RUN_OUTCOME.SKIPPED
            : TOPIC_CLUSTERING_RUN_OUTCOME.COMPLETED,
          mode: data.mode,
          skippedReason: data.skippedReason ?? null,
          tracesProcessed,
          topicsCount: data.topicsCount,
          subtopicsCount: data.subtopicsCount,
          pages,
        };
      },
    );
  }

  handleTopicClusteringRunFailed(
    event: TopicClusteringRunFailedEvent,
    state: TopicClusteringRunHistoryData,
  ): TopicClusteringRunHistoryData {
    return withRun(
      state,
      {
        projectId: String(event.aggregateId),
        runId: event.data.runId,
        occurredAt: event.occurredAt,
      },
      (entry) => ({
        ...entry,
        finishedAt: event.occurredAt,
        outcome: TOPIC_CLUSTERING_RUN_OUTCOME.FAILED,
        errorCode: event.data.errorCode ?? null,
        isErrorUserActionable: event.data.isUserActionable ?? false,
        // A failed run produced no usable counts — mirror the status
        // projection so history and the status card can never disagree
        // about the same run.
        mode: null,
        skippedReason: null,
        tracesProcessed: 0,
        topicsCount: 0,
        subtopicsCount: 0,
        pages: 0,
      }),
    );
  }
}
