import { defineCommand } from "@langwatch/eventing";
import {
  evaluatorResultEventDataSchema,
  experimentRunCompletedEventDataSchema,
  experimentRunStartedEventDataSchema,
  targetResultEventDataSchema,
  traceMetricsComputedEventDataSchema,
} from "./eventing.experiment-run-events.adapter";
import { makeExperimentRunKey } from "../processes/experiment-run-key.process";

/**
 * All experiment-run-processing commands defined from event data schemas.
 *
 * Event data schemas (in events.ts) are the single source of truth.
 * Command data = envelope (tenantId, occurredAt) + event data.
 */

export const StartExperimentRunCommand = defineCommand({
  commandType: "lw.experiment_run.start",
  eventType: "lw.experiment_run.started",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: experimentRunStartedEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:start`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.total": d.total,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:start`,
});

/**
 * The identity of one cell result, used both to order the event and to name
 * its queue job.
 *
 * The store deduplicates on the idempotency key and the queue deduplicates on
 * the job id, so the two must always describe the same cell. One builder for
 * both keeps them that way.
 */
const targetResultIdentity = (d: {
  tenantId: string;
  runId: string;
  targetId: string;
  index: number;
}) => `${d.tenantId}:${d.runId}:target:${d.targetId}:${d.index}`;

const evaluatorResultIdentity = (d: {
  tenantId: string;
  runId: string;
  targetId: string;
  evaluatorId: string;
  index: number;
}) => `${d.tenantId}:${d.runId}:evaluator:${d.targetId}:${d.evaluatorId}:${d.index}`;

export const RecordTargetResultCommand = defineCommand({
  commandType: "lw.experiment_run.record_target_result",
  eventType: "lw.experiment_run.target_result",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: targetResultEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  groupKey: (d) => `${d.experimentId}:${d.runId}:item:${d.index}`,
  idempotencyKey: targetResultIdentity,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.target.id": d.targetId,
    "payload.index": d.index,
  }),
  makeJobId: targetResultIdentity,
});

/**
 * A verdict is identified by its target as well as its evaluator and its row.
 *
 * Every evaluator runs against every target, so two columns produce a verdict
 * for the same evaluator on the same row. `event_log` is a ReplacingMergeTree
 * ordered by the idempotency key, so a key without the target makes those two
 * verdicts one row and one column loses its score.
 */
export const RecordEvaluatorResultCommand = defineCommand({
  commandType: "lw.experiment_run.record_evaluator_result",
  eventType: "lw.experiment_run.evaluator_result",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: evaluatorResultEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  groupKey: (d) => `${d.experimentId}:${d.runId}:item:${d.index}`,
  idempotencyKey: evaluatorResultIdentity,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.target.id": d.targetId,
    "payload.evaluator.id": d.evaluatorId,
    "payload.index": d.index,
  }),
  makeJobId: evaluatorResultIdentity,
});

export const ComputeExperimentRunMetricsCommand = defineCommand({
  commandType: "lw.experiment_run.compute_trace_metrics",
  eventType: "lw.experiment_run.trace_metrics_computed",
  eventVersion: "2026-04-15",
  aggregateType: "experiment_run",
  schema: traceMetricsComputedEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:trace-metrics:${d.traceId}`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.trace.id": d.traceId,
    "payload.total_cost": d.totalCost,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:trace-metrics:${d.traceId}`,
});

export const CompleteExperimentRunCommand = defineCommand({
  commandType: "lw.experiment_run.complete",
  eventType: "lw.experiment_run.completed",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: experimentRunCompletedEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:complete`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:complete`,
});
