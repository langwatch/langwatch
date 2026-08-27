import {
  EVALUATION_REPORTED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_VERSION_LATEST,
  evaluationReportedEventDataSchema,
  type EvaluationProcessingEvent,
  type EvaluationReportedEvent,
  type ExecuteEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import { createTenantId, EventUtils } from "@langwatch/eventing";
import { EvaluationInputsOffloadPort } from "../ports/evaluation.port";

export type EvaluationReportedResult = {
  status: "processed" | "error" | "skipped";
  score?: number;
  passed?: boolean;
  label?: string;
  details?: string;
  inputs?: Record<string, unknown> | null;
  error?: string;
  errorDetails?: string | null;
  costId?: string | null;
};

export class EvaluationReportedEventService {
  static create(inputsOffload: EvaluationInputsOffloadPort): EvaluationReportedEventService {
    return new EvaluationReportedEventService(inputsOffload);
  }

  private constructor(private readonly inputsOffload: EvaluationInputsOffloadPort) {}

  async emit(
    data: ExecuteEvaluationCommandData,
    result: EvaluationReportedResult,
  ): Promise<EvaluationProcessingEvent[]> {
    const inputs = result.inputs
      ? await this.inputsOffload.offload({
          tenantId: data.tenantId,
          evaluationId: data.evaluationId,
          inputs: result.inputs,
        })
      : null;
    const eventData = evaluationReportedEventDataSchema.parse({
      evaluationId: data.evaluationId,
      evaluatorId: data.evaluatorId,
      evaluatorType: data.evaluatorType,
      evaluatorName: data.evaluatorName,
      traceId: data.traceId,
      isGuardrail: data.isGuardrail,
      status: result.status,
      score: result.score ?? null,
      passed: result.passed ?? null,
      label: result.label ?? null,
      details: result.details ?? null,
      inputs,
      error: result.error ?? null,
      errorDetails: result.errorDetails ?? null,
      costId: result.costId ?? null,
    });
    const event = EventUtils.createEvent<EvaluationReportedEvent>({
      aggregateType: "evaluation",
      aggregateId: data.evaluationId,
      tenantId: createTenantId(data.tenantId),
      type: EVALUATION_REPORTED_EVENT_TYPE,
      version: EVALUATION_REPORTED_EVENT_VERSION_LATEST,
      data: eventData,
      occurredAt: data.occurredAt,
      idempotencyKey: `${data.tenantId}:${data.evaluationId}:reported`,
    });

    return [event];
  }
}
