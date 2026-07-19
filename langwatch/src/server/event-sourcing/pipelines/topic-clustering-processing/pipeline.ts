import { definePipeline } from "../../";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import type { EventSubscriberDefinition } from "../../subscribers/eventSubscriber.types";
import {
  RecordClusteringRunCompletedCommand,
  RecordClusteringRunStartedCommand,
  RecordClusteringRunFailedCommand,
  RequestTopicClusteringCommand,
} from "./commands";
import {
  type TopicClusteringRunStatusData,
  TopicClusteringRunStatusFoldProjection,
} from "./projections/topicClusteringRunStatus.foldProjection";
import type { TopicClusteringProcessingEvent } from "./schemas/events";

export interface TopicClusteringProcessingPipelineDeps {
  /** Postgres run-status read model behind the settings page (ADR-051 §7). */
  topicClusteringRunStatusStore: StateProjectionStore<TopicClusteringRunStatusData>;
  /** The process-manager subscriber (and any future live consumers). */
  subscribers?: EventSubscriberDefinition<TopicClusteringProcessingEvent>[];
}

/**
 * Creates the topic-clustering-processing pipeline definition (ADR-051).
 *
 * Aggregate: `topic_clustering` (aggregateId = projectId, TenantId =
 * projectId) — one clustering stream per project.
 *
 * Operational Projection: topicClusteringRunStatus
 * - Per-project last-run facts (outcome, mode, skip reason, counts). Stored
 *   directly in Postgres; rebuildable by replay.
 *
 * Commands (write surface):
 * - requestClustering: manual/bootstrap ask -> topic_clustering.requested
 * - recordClusteringRunStarted: a page began -> run_started
 * - recordClusteringRunCompleted: one page finished -> run_completed
 * - recordClusteringRunFailed: retries exhausted -> run_failed
 *
 * Scheduling is NOT in this pipeline: daily runs are wake-driven inside the
 * TopicClusteringProcess (app-layer/topic-clustering), which consumes these
 * events via the subscriber and dispatches clustering intents through the
 * process outbox.
 */
export function createTopicClusteringProcessingPipeline(
  deps: TopicClusteringProcessingPipelineDeps,
) {
  let builder = definePipeline<TopicClusteringProcessingEvent>()
    .withName("topic_clustering_processing")
    .withAggregateType("topic_clustering")
    .withProjection(
      "topicClusteringRunStatus",
      new TopicClusteringRunStatusFoldProjection({
        store: deps.topicClusteringRunStatusStore,
      }),
    );

  for (const subscriber of deps.subscribers ?? []) {
    builder = builder.withEventSubscriber(subscriber.name, subscriber);
  }

  return builder
    .withCommand("requestClustering", RequestTopicClusteringCommand)
    .withCommand("recordClusteringRunStarted", RecordClusteringRunStartedCommand)
    .withCommand(
      "recordClusteringRunCompleted",
      RecordClusteringRunCompletedCommand,
    )
    .withCommand("recordClusteringRunFailed", RecordClusteringRunFailedCommand)
    .build();
}
