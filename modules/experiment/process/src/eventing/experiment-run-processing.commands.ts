import { defineCommand } from "@langwatch/eventing";

import {
  EXPERIMENT_RUN_COMMAND_TYPES,
  EXPERIMENT_RUN_EVENT_TYPES,
  EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../rules/experiment-run-event-types.rules.ts";
import { makeExperimentRunKey } from "../rules/experiment-run-key.rules.ts";
import {
  abortRequestedEventDataSchema,
  cellFinishedEventDataSchema,
  evaluatorResultEventDataSchema,
  experimentRunCompletedEventDataSchema,
  experimentRunStartedEventDataSchema,
  targetResultEventDataSchema,
  traceMetricsComputedEventDataSchema,
  workflowEvaluationRequestedEventDataSchema,
} from "./experiment-run-events.process.ts";

/**
 * All experiment-run-processing commands defined from event data schemas.
 */

export const StartExperimentRunCommand = defineCommand({
  commandType: "lw.experiment_run.start",
  eventType: "lw.experiment_run.started",
  eventVersion: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
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
  eventVersion: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
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

export const RequestWorkflowEvaluationCommand = defineCommand({
  commandType: "lw.experiment_run.request_workflow_evaluation",
  eventType: "lw.experiment_run.workflow_evaluation_requested",
  eventVersion: "2026-09-25",
  aggregateType: "experiment_run",
  schema: workflowEvaluationRequestedEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:workflow-evaluation`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.workflow.id": d.workflowId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:workflow-evaluation`,
});

/** One cell's terminal, keyed so a cell failed as lost that later finishes is dropped. */
export const cellFinishedIdentity = (d: {
  tenantId: string;
  runId: string;
  ordinal: number;
  phase: number;
}): string => `${d.tenantId}:${d.runId}:cell:${d.ordinal}:${d.phase}:finished`;

/** The stall wake's verdict on a cell whose worker never finished it (spec section 4). */
export const FailExperimentCellCommand = defineCommand({
  commandType: EXPERIMENT_RUN_COMMAND_TYPES.FAIL_CELL,
  eventType: EXPERIMENT_RUN_EVENT_TYPES.CELL_FINISHED,
  eventVersion: EXPERIMENT_RUN_EVENT_VERSIONS.CELL_FINISHED,
  aggregateType: "experiment_run",
  schema: cellFinishedEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  idempotencyKey: cellFinishedIdentity,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
    "payload.cell.ordinal": d.ordinal,
    "payload.cell.phase": d.phase,
  }),
  makeJobId: cellFinishedIdentity,
});

/** A request to stop a run; the Redis flag is the fast signal, this is the durable record. */
export const AbortExperimentRunCommand = defineCommand({
  commandType: EXPERIMENT_RUN_COMMAND_TYPES.ABORT,
  eventType: EXPERIMENT_RUN_EVENT_TYPES.ABORT_REQUESTED,
  eventVersion: EXPERIMENT_RUN_EVENT_VERSIONS.ABORT_REQUESTED,
  aggregateType: "experiment_run",
  schema: abortRequestedEventDataSchema,
  aggregateId: (d) => makeExperimentRunKey(d.experimentId, d.runId),
  idempotencyKey: (d) => `${d.tenantId}:${d.runId}:abort`,
  spanAttributes: (d) => ({
    "payload.run.id": d.runId,
    "payload.experiment.id": d.experimentId,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.runId}:abort`,
});
