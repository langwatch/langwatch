import {
  defineAggregate,
  defineEvents,
  definePipeline,
  type StateProjectionStore,
} from "@langwatch/eventing";
import { TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES } from "@langwatch/topic-contract";
import {
  RecordClusteringRunCompletedCommand,
  RecordClusteringRunFailedCommand,
  RecordClusteringRunStartedCommand,
  RecordTopicsCommand,
  RequestTopicClusteringCommand,
  recordTopicsDedupeId,
  type TopicClusteringDispatchDeps,
} from "../intents/topic-clustering.intent";
import type { TopicClusteringProcessingEvent } from "./eventing.topic.adapter";
import {
  TOPIC_CLUSTERING_PROCESS_NAME,
  topicClusteringPM,
} from "../processes/topic-clustering.process";
import {
  type TopicClusteringRunHistoryData,
  TopicClusteringRunHistoryFoldProjection,
} from "../projections/topic-clustering-run-history.projection";
import {
  type TopicClusteringRunStatusData,
  TopicClusteringRunStatusFoldProjection,
} from "../projections/topic-clustering-run-status.projection";
import {
  type TopicModelData,
  TopicModelFoldProjection,
} from "../projections/topic-model.projection";

// Composition needs the projection state types to declare its stores; the
// projection implementations stay private to the feature server.
export type { TopicClusteringRunHistoryData } from "../projections/topic-clustering-run-history.projection";
export {
  topicClusteringRunHistoryProjectionEntrySchema,
  type TopicClusteringRunHistoryEntry,
} from "../projections/topic-clustering-run-history.projection";
export type { TopicClusteringRunStatusData } from "../projections/topic-clustering-run-status.projection";
export type { ProjectedTopic, TopicModelData } from "../projections/topic-model.projection";

/** Only the executor dependencies are injected — the process-manager
 *  topology itself (state, intents, handlers, outbox tuning) is declared
 *  in `topicClusteringPM`, ADR-052 "Approved builder API", like automations. */
export interface TopicClusteringProcessingPipelineDeps {
  /** Postgres run-status read model behind the settings page (ADR-051 §7). */
  topicClusteringRunStatusStore: StateProjectionStore<TopicClusteringRunStatusData>;
  /** Postgres run-history read model (audit; bounded, newest first). */
  topicClusteringRunHistoryStore: StateProjectionStore<TopicClusteringRunHistoryData>;
  /** Write-through store for the topic model (the Topic table + cursor). */
  topicModelStore: StateProjectionStore<TopicModelData>;
  dispatch: TopicClusteringDispatchDeps;
}

/**
 * The topic-clustering-processing pipeline (ADR-051).
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
 * Process manager: `topicClustering` (ADR-052 builder) — owns the per-project
 * daily wake, run lifecycle, and pagination continuation. It deliberately
 * declares no `.schedule()`: the cadence is each project's own daily hash
 * slot, so every handler returns its explicit `nextWakeAt`. `run_started` is
 * deliberately NOT handled — it exists for the run-status projection, and
 * the process learns nothing from its own announcement.
 */
export class TopicClusteringEventingAdapter {
  private constructor(private readonly deps: TopicClusteringProcessingPipelineDeps) {}

  static create(deps: TopicClusteringProcessingPipelineDeps): TopicClusteringEventingAdapter {
    return new TopicClusteringEventingAdapter(deps);
  }

  static createPipeline(deps: TopicClusteringProcessingPipelineDeps) {
    return TopicClusteringEventingAdapter.create(deps).build();
  }

  build() {
    return definePipeline<TopicClusteringProcessingEvent>({
      name: "topic_clustering_processing",
      aggregate: defineAggregate({
        type: "topic_clustering",
        events: defineEvents(TOPIC_CLUSTERING_PROCESSING_EVENT_TYPES),
      }),
    })
      .withPostgresProjection(
        new TopicClusteringRunStatusFoldProjection({
          store: this.deps.topicClusteringRunStatusStore,
        }),
      )
      .withPostgresProjection(
        new TopicClusteringRunHistoryFoldProjection({
          store: this.deps.topicClusteringRunHistoryStore,
        }),
      )
      .withPostgresProjection(new TopicModelFoldProjection({ store: this.deps.topicModelStore }))
      .withCommand("requestClustering", RequestTopicClusteringCommand)
      .withCommand("recordClusteringRunStarted", RecordClusteringRunStartedCommand)
      .withCommand("recordClusteringRunCompleted", RecordClusteringRunCompletedCommand)
      .withCommand("recordClusteringRunFailed", RecordClusteringRunFailedCommand)
      .withCommand("recordTopics", RecordTopicsCommand, {
        // Suppress duplicate appends for the same dedupeKey at enqueue (the
        // boot seed racing the write-path seed, or a retried page). TTL-bound
        // and best-effort — the fold's stale-seed guard is the correctness
        // backstop (topic-model.projection.ts).
        deduplication: {
          makeId: recordTopicsDedupeId,
          ttlMs: 60_000,
        },
      })
      .withProcessManager(TOPIC_CLUSTERING_PROCESS_NAME, topicClusteringPM(this.deps.dispatch))
      .build();
  }
}

export const createTopicClusteringProcessingPipeline =
  TopicClusteringEventingAdapter.createPipeline;
