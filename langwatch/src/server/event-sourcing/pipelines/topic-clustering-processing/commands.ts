import { defineCommand } from "../../commands/defineCommand";
import {
  topicClusteringRequestedEventDataSchema,
  topicClusteringTopicsRecordedEventDataSchema,
  topicClusteringRunCompletedEventDataSchema,
  topicClusteringRunFailedEventDataSchema,
  topicClusteringRunStartedEventDataSchema,
} from "./schemas/events";

/**
 * All topic-clustering-processing commands defined from event data schemas
 * (ADR-051 §1). Event data schemas are the single source of truth; command
 * data = envelope (tenantId, occurredAt, idempotencyKey?) + event data.
 *
 * The aggregate is the project: aggregateId = tenantId = projectId, so every
 * command for one project folds and subscribes in FIFO order.
 */

export const RequestTopicClusteringCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.request",
  eventType: "lw.obs.topic_clustering.requested",
  eventVersion: "2026-07-17",
  aggregateType: "topic_clustering",
  schema: topicClusteringRequestedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  // Bootstrap is once-per-project (re-sends collapse in the event log and
  // are harmless to the process); manual requests are each their own ask.
  idempotencyKey: (d) =>
    d.trigger === "bootstrap"
      ? `${String(d.tenantId)}:topic_clustering:bootstrap`
      : `${String(d.tenantId)}:topic_clustering:request:${d.occurredAt}`,
  spanAttributes: (d) => ({
    "payload.trigger": d.trigger,
  }),
  makeJobId: (d) =>
    d.trigger === "bootstrap"
      ? `${String(d.tenantId)}:topic_clustering:bootstrap`
      : `${String(d.tenantId)}:topic_clustering:request:${d.occurredAt}`,
});

export const RecordClusteringRunStartedCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.record_run_started",
  eventType: "lw.obs.topic_clustering.run_started",
  eventVersion: "2026-07-19",
  aggregateType: "topic_clustering",
  schema: topicClusteringRunStartedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  // Keyed per page, so a redelivered intent re-announces the same page
  // rather than appending a second start for it.
  idempotencyKey: (d) =>
    `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:started`,
  spanAttributes: (d) => ({
    "payload.run_id": d.runId,
    "payload.page": d.page,
  }),
  makeJobId: (d) =>
    `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:started`,
});

export const RecordClusteringRunCompletedCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.record_run_completed",
  eventType: "lw.obs.topic_clustering.run_completed",
  eventVersion: "2026-07-17",
  aggregateType: "topic_clustering",
  schema: topicClusteringRunCompletedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  idempotencyKey: (d) =>
    `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:completed`,
  spanAttributes: (d) => ({
    "payload.run_id": d.runId,
    "payload.page": d.page,
    "payload.mode": d.mode,
    "payload.traces_processed": d.tracesProcessed,
  }),
  makeJobId: (d) =>
    `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:completed`,
});

export const RecordClusteringRunFailedCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.record_run_failed",
  eventType: "lw.obs.topic_clustering.run_failed",
  eventVersion: "2026-07-17",
  aggregateType: "topic_clustering",
  schema: topicClusteringRunFailedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  idempotencyKey: (d) =>
    `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:failed`,
  spanAttributes: (d) => ({
    "payload.run_id": d.runId,
    "payload.page": d.page,
  }),
  makeJobId: (d) =>
    `${String(d.tenantId)}:topic_clustering:${d.runId}:page-${d.page}:failed`,
});

/**
 * One key for both the event idempotencyKey and the enqueue dedup id, so a
 * redelivered page or a re-run seed collapses instead of appending again.
 * Exported for the pipeline's `deduplication.makeId` wiring.
 */
export const recordTopicsDedupeId = (d: {
  tenantId: PropertyKey;
  dedupeKey: string;
}): string => `${String(d.tenantId)}:topic_clustering:topics:${d.dedupeKey}`;

export const RecordTopicsCommand = defineCommand({
  commandType: "lw.obs.topic_clustering.record_topics",
  eventType: "lw.obs.topic_clustering.topics_recorded",
  eventVersion: "2026-07-20",
  aggregateType: "topic_clustering",
  schema: topicClusteringTopicsRecordedEventDataSchema,
  aggregateId: (d) => String(d.tenantId),
  // Keyed by the caller's dedupeKey (`run:<id>:page-<n>` / `seed:v1`).
  idempotencyKey: recordTopicsDedupeId,
  spanAttributes: (d) => ({
    "payload.mode": d.mode,
    "payload.source": d.source,
    "payload.topics_count": d.topics.length,
  }),
  makeJobId: recordTopicsDedupeId,
});
