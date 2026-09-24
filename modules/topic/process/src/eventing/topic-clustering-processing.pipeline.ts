/**
 * Topic clustering's pipeline, ported from main's deleted `PrismaTopicServerInstallerRepository`:
 * the app builds the definition, and the senders are bound back to it once registered.
 */
import {
  defineAggregate,
  defineEventingModule,
  definePipeline,
  type EventingSetup,
  type StateProjectionStore,
} from "@langwatch/eventing";

import type { TopicApp } from "../app/topic.app.ts";
import type { TopicRepositories } from "../repositories/topic.repositories.ts";
import {
  TopicClusteringRequestedEventSchema,
  TopicClusteringRunStartedEventSchema,
  TopicClusteringRunCompletedEventSchema,
  TopicClusteringRunFailedEventSchema,
  TopicClusteringTopicsRecordedEventSchema,
} from "../services/topic-events.service.ts";
import {
  type TopicClusteringRunHistoryData,
  TopicClusteringRunHistoryFoldProjection,
} from "./topic-clustering-run-history.projection.ts";
import {
  type TopicClusteringRunStatusData,
  TopicClusteringRunStatusFoldProjection,
} from "./topic-clustering-run-status.projection.ts";
import {
  RecordClusteringRunCompletedCommand,
  RecordClusteringRunFailedCommand,
  RecordClusteringRunStartedCommand,
  RecordTopicsCommand,
  RequestTopicClusteringCommand,
  recordTopicsDedupeId,
  type TopicClusteringDispatchDeps,
} from "./topic-clustering.intent.ts";
import {
  TOPIC_CLUSTERING_PROCESS_NAME,
  TopicClusteringProcess,
} from "./topic-clustering.process.ts";
import { type TopicModelData, TopicModelFoldProjection } from "./topic-model.projection.ts";

export const TOPIC_CLUSTERING_PIPELINE_NAME = "topic_clustering_processing";

/** Only the executor dependencies are injected — the process-manager
 *  topology itself (state, intents, handlers, outbox tuning) is declared
 *  in `TopicClusteringProcess.processManager`, ADR-052 "Approved builder API", like automations. */
export interface TopicClusteringProcessingPipelineDeps {
  /** Postgres run-status read model behind the settings page (ADR-051 §7). */
  topicClusteringRunStatusStore: StateProjectionStore<TopicClusteringRunStatusData>;
  /** Postgres run-history read model (audit; bounded, newest first). */
  topicClusteringRunHistoryStore: StateProjectionStore<TopicClusteringRunHistoryData>;
  /** Write-through store for the topic model (the Topic table + cursor). */
  topicModelStore: StateProjectionStore<TopicModelData>;
  dispatch: TopicClusteringDispatchDeps;
}

/** The topic_clustering_processing pipeline definition itself, built once per deps. */
const buildTopicClusteringProcessingPipeline = (deps: TopicClusteringProcessingPipelineDeps) => {
  return definePipeline({
    name: TOPIC_CLUSTERING_PIPELINE_NAME,
    aggregate: defineAggregate({
      type: "topic_clustering",
    }),
  })
    .withEvents([
      TopicClusteringRequestedEventSchema,
      TopicClusteringRunStartedEventSchema,
      TopicClusteringRunCompletedEventSchema,
      TopicClusteringRunFailedEventSchema,
      TopicClusteringTopicsRecordedEventSchema,
    ])
    .withPostgresProjection(
      TopicClusteringRunStatusFoldProjection.create({
        store: deps.topicClusteringRunStatusStore,
      }),
    )
    .withPostgresProjection(
      TopicClusteringRunHistoryFoldProjection.create({
        store: deps.topicClusteringRunHistoryStore,
      }),
    )
    .withPostgresProjection(TopicModelFoldProjection.create({ store: deps.topicModelStore }))
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
    .withProcessManager(
      TOPIC_CLUSTERING_PROCESS_NAME,
      TopicClusteringProcess.processManager(deps.dispatch),
    )
    .build();
};

export type TopicClusteringProcessingPipelineDefinition = ReturnType<
  typeof buildTopicClusteringProcessingPipeline
>;

export function createTopicClusteringProcessingPipeline(
  deps: TopicClusteringProcessingPipelineDeps,
): TopicClusteringProcessingPipelineDefinition {
  return buildTopicClusteringProcessingPipeline(deps);
}

/** Passive in the api process, which only sends; the worker folds and drives the runs. */
export const topicClusteringEventing = defineEventingModule({
  pipeline: TOPIC_CLUSTERING_PIPELINE_NAME,
  build: ({ app }: EventingSetup<TopicRepositories, TopicApp>) => app.eventingPipeline(),
  connect: ({ app, commands }) => app.connectCommands(commands),
});
