import { defineCommand } from "../../commands/defineCommand";
import {
  topicClusteringRequestedEventDataSchema,
  topicClusteringRunCompletedEventDataSchema,
  topicClusteringRunFailedEventDataSchema,
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
