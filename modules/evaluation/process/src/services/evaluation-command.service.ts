import {
  EVALUATION_COMMAND_TYPES,
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
  EVALUATION_REPORTED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_VERSION_LATEST,
  EVALUATION_STARTED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_VERSION_LATEST,
  completeEvaluationCommandDataSchema,
  reportEvaluationCommandDataSchema,
  startEvaluationCommandDataSchema,
} from "@langwatch/evaluation-contract";
import { defineCommand } from "@langwatch/eventing";

export class EvaluationCommandAdapter {
  static create(): EvaluationCommandAdapter {
    return new EvaluationCommandAdapter();
  }

  private constructor() {}

  readonly start = defineCommand({
    commandType: EVALUATION_COMMAND_TYPES.START,
    eventType: EVALUATION_STARTED_EVENT_TYPE,
    eventVersion: EVALUATION_STARTED_EVENT_VERSION_LATEST,
    aggregateType: "evaluation",
    schema: startEvaluationCommandDataSchema,
    aggregateId: (data) => data.evaluationId,
    idempotencyKey: (data) => `${data.tenantId}:${data.evaluationId}:started`,
    spanAttributes: (data) => ({
      "payload.evaluation.id": data.evaluationId,
      "payload.evaluator.id": data.evaluatorId,
      "payload.evaluator.type": data.evaluatorType,
      ...(data.traceId ? { "payload.trace.id": data.traceId } : {}),
    }),
    makeJobId: (data) => `${data.tenantId}:${data.evaluationId}:start`,
  });

  readonly complete = defineCommand({
    commandType: EVALUATION_COMMAND_TYPES.COMPLETE,
    eventType: EVALUATION_COMPLETED_EVENT_TYPE,
    eventVersion: EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
    aggregateType: "evaluation",
    schema: completeEvaluationCommandDataSchema,
    aggregateId: (data) => data.evaluationId,
    idempotencyKey: (data) => `${data.tenantId}:${data.evaluationId}:completed`,
    spanAttributes: (data) => ({
      "payload.evaluation.id": data.evaluationId,
      "payload.status": data.status,
    }),
    makeJobId: (data) => `${data.tenantId}:${data.evaluationId}:complete`,
  });

  readonly report = defineCommand({
    commandType: EVALUATION_COMMAND_TYPES.REPORT,
    eventType: EVALUATION_REPORTED_EVENT_TYPE,
    eventVersion: EVALUATION_REPORTED_EVENT_VERSION_LATEST,
    aggregateType: "evaluation",
    schema: reportEvaluationCommandDataSchema,
    aggregateId: (data) => data.evaluationId,
    idempotencyKey: (data) => `${data.tenantId}:${data.evaluationId}:reported`,
    spanAttributes: (data) => ({
      "payload.evaluation.id": data.evaluationId,
      "payload.evaluator.id": data.evaluatorId,
      "payload.evaluator.type": data.evaluatorType,
      "payload.status": data.status,
    }),
    makeJobId: (data) => `${data.tenantId}:${data.evaluationId}:report`,
  });
}
