import { TOPIC_CLUSTERING_EVENT_TYPES } from "./constants";
import type {
  TopicClusteringProcessingEvent,
  TopicClusteringRequestedEvent,
  TopicClusteringRunCompletedEvent,
  TopicClusteringRunFailedEvent,
} from "./events";

export function isTopicClusteringRequestedEvent(
  event: TopicClusteringProcessingEvent,
): event is TopicClusteringRequestedEvent {
  return event.type === TOPIC_CLUSTERING_EVENT_TYPES.REQUESTED;
}

export function isTopicClusteringRunCompletedEvent(
  event: TopicClusteringProcessingEvent,
): event is TopicClusteringRunCompletedEvent {
  return event.type === TOPIC_CLUSTERING_EVENT_TYPES.RUN_COMPLETED;
}

export function isTopicClusteringRunFailedEvent(
  event: TopicClusteringProcessingEvent,
): event is TopicClusteringRunFailedEvent {
  return event.type === TOPIC_CLUSTERING_EVENT_TYPES.RUN_FAILED;
}
