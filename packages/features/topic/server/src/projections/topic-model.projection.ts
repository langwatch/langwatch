import type { StateProjectionStore } from "@langwatch/eventing";
import { AbstractFoldProjection, type FoldEventHandlers } from "@langwatch/eventing";
import {
  TOPIC_CLUSTERING_PROJECTION_VERSIONS,
  TOPIC_MODEL_RECORD_MODE,
  TOPIC_MODEL_RECORD_SOURCE,
  type TopicModelEntry,
} from "@langwatch/topic-contract";
import type { TopicClusteringTopicsRecordedEvent } from "../adapters/eventing.topic.events";
import { TopicClusteringTopicsRecordedEventSchema } from "../adapters/eventing.topic.events";

/** A projected topic with its firstRecordedAt resolved (never optional). */
export type ProjectedTopic = Omit<TopicModelEntry, "firstRecordedAt"> & {
  firstRecordedAt: number;
  /**
   * The `topics_recorded` event that recorded this topic — per-row provenance into the event
   * log. A merge keeps untouched topics' provenance, so this names the event that actually
   * carried the topic, not merely the last fold.
   */
  recordedByEventId: string | null;
};

/**
 * The project's topic model (ADR-051): topics are facts on the clustering
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

  static create(deps: { store: StateProjectionStore<TopicModelData> }): TopicModelFoldProjection {
    return new TopicModelFoldProjection(deps);
  }

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
    // A seed is only meaningful as the model's FIRST record: it exists to put pre-ownership
    // Topic rows onto the stream. Once any event has folded topics, a seed is by definition
    // stale — and it MUST fold as a no-op, because nothing upstream enforces the `seed:v1`
    // idempotency key (the command has no queue dedup and ClickHouse inserts cannot be unique).
    if (event.data.source === TOPIC_MODEL_RECORD_SOURCE.SEED && state.Topics.length > 0) {
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
        topic.firstRecordedAt ?? existingById.get(topic.id)?.firstRecordedAt ?? event.occurredAt,
      recordedByEventId: event.id,
    }));

    if (event.data.mode === TOPIC_MODEL_RECORD_MODE.REPLACE) {
      return { ...state, ProjectId: projectId, Topics: recorded };
    }

    const recordedIds = new Set(recorded.map((t) => t.id));
    return {
      ...state,
      ProjectId: projectId,
      Topics: [...state.Topics.filter((t) => !recordedIds.has(t.id)), ...recorded],
    };
  }
}
