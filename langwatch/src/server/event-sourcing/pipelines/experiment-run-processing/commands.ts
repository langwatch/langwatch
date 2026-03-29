import { defineCommand } from "../../commands/defineCommand";
import {
  experimentRunStartedEventDataSchema,
  targetResultEventDataSchema,
  evaluatorResultEventDataSchema,
  experimentRunCompletedEventDataSchema,
} from "./schemas/events";
import { makeExperimentRunKey } from "./utils/compositeKey";

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

export const RecordTargetResultCommand = defineCommand({
  commandType: "lw.experiment_run.record_target_result",
  eventType: "lw.experiment_run.target_result",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: targetResultEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  groupKey: (d) => `${d.experimentId}:${d.runId}:item:${d.index}`,
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:target:${d.targetId}:${d.index}`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.target.id": d.targetId,
    "payload.index": d.index,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:target:${d.targetId}:${d.index}`,
});

export const RecordEvaluatorResultCommand = defineCommand({
  commandType: "lw.experiment_run.record_evaluator_result",
  eventType: "lw.experiment_run.evaluator_result",
  eventVersion: "2025-02-01",
  aggregateType: "experiment_run",
  schema: evaluatorResultEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  groupKey: (d) => `${d.experimentId}:${d.runId}:item:${d.index}`,
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:evaluator:${d.evaluatorId}:${d.index}`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.evaluator.id": d.evaluatorId,
    "payload.index": d.index,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:evaluator:${d.evaluatorId}:${d.index}`,
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
