import {
  AbstractFoldProjection,
  type FoldEventHandlers,
} from "../../../projections/abstractFoldProjection";
import type { StateProjectionStore } from "../../../projections/stateProjection.types";
import {
  TOPIC_CLUSTERING_PROJECTION_VERSIONS,
  TOPIC_MODEL_RECORD_MODE,
  TOPIC_MODEL_RECORD_SOURCE,
} from "../schemas/constants";
import type {
  TopicClusteringTopicsRecordedEvent,
  TopicModelEntry,
} from "../schemas/events";
import { TopicClusteringTopicsRecordedEventSchema } from "../schemas/events";

/** A projected topic with its firstRecordedAt resolved (never optional). */
export type ProjectedTopic = Omit<TopicModelEntry, "firstRecordedAt"> & {
  firstRecordedAt: number;
};

/**
 * The project's topic model (ADR-051): topics are facts on the clustering
 * stream, and the Postgres `Topic` table is THIS projection's write-through
 * store — nothing else writes it. Rebuildable by replay; ids pass through
 * unchanged so ClickHouse TopicId/SubTopicId references stay valid.
 */
export interface TopicModelData {
  ProjectId: string;
  Topics: ProjectedTopic[];
  CreatedAt: number;
  UpdatedAt: number;
  LastEventOccurredAt: number;
}

const topicModelEvents = [TopicClusteringTopicsRecordedEventSchema] as const;

export class TopicModelFoldProjection
  extends AbstractFoldProjection<
    TopicModelData,
    typeof topicModelEvents,
    "CreatedAt",
    "UpdatedAt",
    "LastEventOccurredAt",
    StateProjectionStore<TopicModelData>
  >
  implements FoldEventHandlers<typeof topicModelEvents, TopicModelData>
{
  readonly name = "topicModel";
  readonly version = TOPIC_CLUSTERING_PROJECTION_VERSIONS.TOPIC_MODEL;
  readonly store: StateProjectionStore<TopicModelData>;

  protected readonly events = topicModelEvents;

  constructor(deps: { store: StateProjectionStore<TopicModelData> }) {
    super();
    this.store = deps.store;
  }

  protected initState() {
    return {
      ProjectId: "",
      Topics: [],
    };
  }

  handleTopicClusteringTopicsRecorded(
    event: TopicClusteringTopicsRecordedEvent,
    state: TopicModelData,
  ): TopicModelData {
    // A seed is only meaningful as the model's FIRST record: it exists to
    // put pre-ownership Topic rows onto the stream. Once any event has
    // folded topics, a seed is by definition stale — and it MUST fold as a
    // no-op, because nothing upstream enforces the `seed:v1` idempotency
    // key (the command has no queue dedup and ClickHouse inserts cannot be
    // unique). Without this guard, a boot seed racing the write-path seed
    // during projection lag appends a second replace-mode seed with a later
    // occurredAt, which would fold last and delete the clustering delta.
    // The guard also keeps live folds identical to replay, whose read path
    // DOES collapse duplicate idempotency keys.
    if (
      event.data.source === TOPIC_MODEL_RECORD_SOURCE.SEED &&
      state.Topics.length > 0
    ) {
      return state;
    }

    const projectId = String(event.aggregateId);
    const existingById = new Map(state.Topics.map((t) => [t.id, t]));
    const recorded: ProjectedTopic[] = event.data.topics.map((topic) => ({
      ...topic,
      // Preserve when the topic first existed: an explicit seed timestamp
      // wins, then an already-projected topic keeps its own, then the event
      // instant. The batch cadence gate reads this age.
      firstRecordedAt:
        topic.firstRecordedAt ??
        existingById.get(topic.id)?.firstRecordedAt ??
        event.occurredAt,
    }));

    if (event.data.mode === TOPIC_MODEL_RECORD_MODE.REPLACE) {
      return { ...state, ProjectId: projectId, Topics: recorded };
    }

    const recordedIds = new Set(recorded.map((t) => t.id));
    return {
      ...state,
      ProjectId: projectId,
      Topics: [
        ...state.Topics.filter((t) => !recordedIds.has(t.id)),
        ...recorded,
      ],
    };
  }
}
