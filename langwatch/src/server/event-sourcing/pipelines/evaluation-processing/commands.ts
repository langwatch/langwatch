import { defineCommand } from "../../commands/defineCommand";
import {
  evaluationStartedEventDataSchema,
  evaluationCompletedEventDataSchema,
  evaluationReportedEventDataSchema,
} from "./schemas/events";

/**
 * Pure evaluation-processing commands defined from event data schemas.
 *
 * executeEvaluation is NOT here — it's a complex command with DI (monitors,
 * spans, evaluationExecution) and stays as a manual class.
 */

export const StartEvaluationCommand = defineCommand({
  commandType: "lw.evaluation.start",
  eventType: "lw.evaluation.started",
  eventVersion: "2025-01-14",
  aggregateType: "evaluation",
  schema: evaluationStartedEventDataSchema,
  aggregateId: (d) => d.evaluationId,
  idempotencyKey: (d) => `${d.tenantId}:${d.evaluationId}:started`,
  spanAttributes: (d) => ({
    "payload.evaluation.id": d.evaluationId,
    "payload.evaluator.id": d.evaluatorId,
    "payload.evaluator.type": d.evaluatorType,
    ...(d.traceId && { "payload.trace.id": d.traceId }),
  }),
  makeJobId: (d) => `${d.tenantId}:${d.evaluationId}:start`,
});

export const CompleteEvaluationCommand = defineCommand({
  commandType: "lw.evaluation.complete",
  eventType: "lw.evaluation.completed",
  eventVersion: "2025-01-14",
  aggregateType: "evaluation",
  schema: evaluationCompletedEventDataSchema,
  aggregateId: (d) => d.evaluationId,
  idempotencyKey: (d) => `${d.tenantId}:${d.evaluationId}:completed`,
  spanAttributes: (d) => ({
    "payload.evaluation.id": d.evaluationId,
    "payload.status": d.status,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.evaluationId}:complete`,
});

export const ReportEvaluationCommand = defineCommand({
  commandType: "lw.evaluation.report",
  eventType: "lw.evaluation.reported",
  eventVersion: "2025-01-14",
  aggregateType: "evaluation",
  schema: evaluationReportedEventDataSchema,
  aggregateId: (d) => d.evaluationId,
  idempotencyKey: (d) => `${d.tenantId}:${d.evaluationId}:reported`,
  spanAttributes: (d) => ({
    "payload.evaluation.id": d.evaluationId,
    "payload.evaluator.id": d.evaluatorId,
    "payload.evaluator.type": d.evaluatorType,
    "payload.status": d.status,
  }),
  makeJobId: (d) => `${d.tenantId}:${d.evaluationId}:report`,
});
