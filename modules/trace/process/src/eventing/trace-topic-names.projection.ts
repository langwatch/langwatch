/**
 * Trace's own copy of a project's topic names: a peer fold (§9) over topic's `topics_recorded`
 * fact, mirroring topic's fold (a REPLACE drops removed topics; a late seed folds as nothing).
 * Spec: modules/trace/specs/trace-topic-names.feature
 */
import type {
  FoldProjectionStore,
  PeerEvent,
  PeerFoldProjectionDeclaration,
} from "@langwatch/eventing";
import {
  TOPIC_CLUSTERING_EVENT_TYPES,
  TOPIC_MODEL_RECORD_MODE,
  TOPIC_MODEL_RECORD_SOURCE,
  topicClusteringTopicsRecordedEventDataSchema,
} from "@langwatch/topic-contract";

import {
  TRACE_TOPIC_NAMES_PROJECTION_VERSION,
  type TraceTopicNamesFoldState,
} from "../repositories/trace-topic-names.repository.ts";

/** The fold's name; its global lane is `<host pipeline>.topicNames`. */
export const TRACE_TOPIC_NAMES_PROJECTION_NAME = "topicNames" as const;

/** Topic's model fact, parsed by topic-contract's own schema. */
export const traceTopicNamesPeerEvents = [
  {
    type: TOPIC_CLUSTERING_EVENT_TYPES.TOPICS_RECORDED,
    data: topicClusteringTopicsRecordedEventDataSchema,
  },
] as const;

export type TraceTopicNamesPeerEvent = PeerEvent<typeof traceTopicNamesPeerEvents>;

/** Topic's own fold rule over one `topics_recorded`, keeping only names and parents. */
export function foldTraceTopicNames(
  state: TraceTopicNamesFoldState,
  event: TraceTopicNamesPeerEvent,
): TraceTopicNamesFoldState {
  const LastEventOccurredAt = Math.max(state.LastEventOccurredAt, event.occurredAt);
  // A seed only puts pre-ownership topics on the stream; once topics exist it is stale.
  if (event.data.source === TOPIC_MODEL_RECORD_SOURCE.SEED && state.topics.length > 0) {
    return { ...state, LastEventOccurredAt };
  }
  const recorded = event.data.topics.map(({ id, name, parentId }) => ({ id, name, parentId }));
  if (event.data.mode === TOPIC_MODEL_RECORD_MODE.REPLACE) {
    return { topics: recorded, LastEventOccurredAt };
  }
  const recordedIds = new Set(recorded.map((topic) => topic.id));
  return {
    topics: [...state.topics.filter((topic) => !recordedIds.has(topic.id)), ...recorded],
    LastEventOccurredAt,
  };
}

/** The peer fold trace hosts on its own pipeline, over its own store. */
export function traceTopicNamesPeerFold(
  store: FoldProjectionStore<TraceTopicNamesFoldState>,
): PeerFoldProjectionDeclaration<TraceTopicNamesFoldState, typeof traceTopicNamesPeerEvents> {
  return {
    events: traceTopicNamesPeerEvents,
    fold: {
      name: TRACE_TOPIC_NAMES_PROJECTION_NAME,
      version: TRACE_TOPIC_NAMES_PROJECTION_VERSION,
      eventTypes: traceTopicNamesPeerEvents.map(({ type }) => type),
      init: () => ({ topics: [], LastEventOccurredAt: 0 }),
      apply: foldTraceTopicNames,
      store,
      LastEventOccurredAtKey: "LastEventOccurredAt",
    },
  };
}
