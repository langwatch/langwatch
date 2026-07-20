import {
  buildProcessEventView,
  handleClusteringRequested,
  handleClusteringRunCompleted,
  handleClusteringRunFailed,
  INITIAL_TOPIC_CLUSTERING_STATE,
  topicClusteringWake,
} from "~/server/event-sourcing/pipelines/topic-clustering-processing/process-manager/topicClustering.process";
import {
  createTopicClusteringRunHandler,
  TOPIC_CLUSTERING_MAX_ATTEMPTS,
  TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE,
  TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS,
  type TopicClusteringDispatchDeps,
} from "~/server/event-sourcing/pipelines/topic-clustering-processing/process-manager/topicClusteringIntentHandlers";
import {
  TOPIC_CLUSTERING_PROCESS_INTENT_TYPES,
  TOPIC_CLUSTERING_PROCESS_NAME,
  topicClusteringRunIntentSchema,
} from "~/server/event-sourcing/pipelines/topic-clustering-processing/process-manager/topicClusteringProcess.types";

import { definePipeline } from "../../";
import type { ProcessManagerApplier } from "../../pipeline/processBuilder";
import type { StateProjectionStore } from "../../projections/stateProjection.types";
import {
  RecordClusteringRunCompletedCommand,
  RecordClusteringRunStartedCommand,
  RecordClusteringRunFailedCommand,
  RecordTopicsCommand,
  RequestTopicClusteringCommand,
} from "./commands";
import { TOPIC_CLUSTERING_EVENT_TYPES } from "./schemas/constants";
import {
  type TopicClusteringRunHistoryData,
  TopicClusteringRunHistoryFoldProjection,
} from "./projections/topicClusteringRunHistory.foldProjection";
import {
  type TopicClusteringRunStatusData,
  TopicClusteringRunStatusFoldProjection,
} from "./projections/topicClusteringRunStatus.foldProjection";
import {
  type TopicModelData,
  TopicModelFoldProjection,
} from "./projections/topicModel.foldProjection";
import type { TopicClusteringProcessingEvent } from "./schemas/events";

/** Only the executor dependencies are injected — the process-manager
 *  topology itself (state, intents, handlers, outbox tuning) is declared
 *  inline below, ADR-052 "Approved builder API", like automations. */
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
 * The `topicClustering` process-manager topology, exported standalone so
 * tests can build the exact definition the runtime mounts (clamping, key
 * prefixing, undeclared-event guard included) via `buildProcessManager` +
 * `buildProcessDefinition`.
 */
export function topicClusteringPM(
  dispatch: TopicClusteringDispatchDeps,
): ProcessManagerApplier<TopicClusteringProcessingEvent> {
  return (pm) =>
    pm
      .state(INITIAL_TOPIC_CLUSTERING_STATE)
      .intent(
        TOPIC_CLUSTERING_PROCESS_INTENT_TYPES.RUN,
        topicClusteringRunIntentSchema,
        createTopicClusteringRunHandler(dispatch),
      )
      .on(TOPIC_CLUSTERING_EVENT_TYPES.REQUESTED, handleClusteringRequested)
      .on(
        TOPIC_CLUSTERING_EVENT_TYPES.RUN_COMPLETED,
        handleClusteringRunCompleted,
      )
      .on(TOPIC_CLUSTERING_EVENT_TYPES.RUN_FAILED, handleClusteringRunFailed)
      .onWake(topicClusteringWake)
      .toPayload(buildProcessEventView)
      .outbox({
        // Parity with the BullMQ worker this replaces: 3 attempts, then
        // the failure is recorded durably (the executor owns the
        // final-attempt record; the cap here is the backstop for
        // executor-crash paths).
        maxAttempts: TOPIC_CLUSTERING_MAX_ATTEMPTS,
        leaseDurationMs: TOPIC_CLUSTERING_OUTBOX_LEASE_DURATION_MS,
        // ADR-051 §4 promises langevals sees the same load profile as the
        // old worker's `concurrency: 3`; the batch bound keeps leased
        // messages from waiting invisibly behind a slow page.
        concurrency: TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE,
        batchSize: TOPIC_CLUSTERING_OUTBOX_BATCH_SIZE,
      });
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
 * Process manager: `topicClustering` (ADR-052 builder) — owns the per-project
 * daily wake, run lifecycle, and pagination continuation. It deliberately
 * declares no `.schedule()`: the cadence is each project's own daily hash
 * slot, so every handler returns its explicit `nextWakeAt`. `run_started` is
 * deliberately NOT handled — it exists for the run-status projection, and
 * the process learns nothing from its own announcement.
 */
export function createTopicClusteringProcessingPipeline(
  deps: TopicClusteringProcessingPipelineDeps,
) {
  return definePipeline<TopicClusteringProcessingEvent>()
    .withName("topic_clustering_processing")
    .withAggregateType("topic_clustering")
    .withProjection(
      "topicClusteringRunStatus",
      new TopicClusteringRunStatusFoldProjection({
        store: deps.topicClusteringRunStatusStore,
      }),
    )
    .withProjection(
      "topicClusteringRunHistory",
      new TopicClusteringRunHistoryFoldProjection({
        store: deps.topicClusteringRunHistoryStore,
      }),
    )
    .withProjection(
      "topicModel",
      new TopicModelFoldProjection({ store: deps.topicModelStore }),
    )
    .withCommand("requestClustering", RequestTopicClusteringCommand)
    .withCommand("recordClusteringRunStarted", RecordClusteringRunStartedCommand)
    .withCommand(
      "recordClusteringRunCompleted",
      RecordClusteringRunCompletedCommand,
    )
    .withCommand("recordClusteringRunFailed", RecordClusteringRunFailedCommand)
    .withCommand("recordTopics", RecordTopicsCommand)
    .withProcessManager(
      TOPIC_CLUSTERING_PROCESS_NAME,
      topicClusteringPM(deps.dispatch),
    )
    .build();
}
