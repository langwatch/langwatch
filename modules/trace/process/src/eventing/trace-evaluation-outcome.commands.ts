import type { Command, CommandHandler } from "@langwatch/eventing";
import { createTenantId, defineCommandSchema, EventUtils } from "@langwatch/eventing";
import {
  EVALUATION_OUTCOME_RECORDED_EVENT_TYPE,
  EVALUATION_OUTCOME_RECORDED_EVENT_VERSION_LATEST,
  type EvaluationOutcomeRecordedEvent,
  RECORD_EVALUATION_OUTCOME_COMMAND_TYPE,
  type RecordEvaluationOutcomeCommandData,
  recordEvaluationOutcomeCommandDataSchema,
} from "@langwatch/trace-contract";

/**
 * Records an evaluation's outcome on its trace, so the trace analytics fold orders it with the
 * trace's own events (trace ADR-003).
 */
export class EventingTraceEvaluationOutcomeAdapter implements CommandHandler<
  Command<RecordEvaluationOutcomeCommandData>,
  EvaluationOutcomeRecordedEvent
> {
  static create(): EventingTraceEvaluationOutcomeAdapter {
    return new EventingTraceEvaluationOutcomeAdapter();
  }

  static readonly schema = defineCommandSchema(
    RECORD_EVALUATION_OUTCOME_COMMAND_TYPE,
    recordEvaluationOutcomeCommandDataSchema,
    "Command to record an evaluation's outcome on its trace",
  );

  async handle(
    command: Command<RecordEvaluationOutcomeCommandData>,
  ): Promise<EvaluationOutcomeRecordedEvent[]> {
    const { data } = command;
    return [
      EventUtils.createEvent<EvaluationOutcomeRecordedEvent>({
        aggregateType: "trace",
        aggregateId: data.traceId,
        tenantId: createTenantId(command.tenantId),
        type: EVALUATION_OUTCOME_RECORDED_EVENT_TYPE,
        version: EVALUATION_OUTCOME_RECORDED_EVENT_VERSION_LATEST,
        // The trace's OccurredAt: the fold reads back in a window around the event's time, so
        // one stamped at the evaluation's time could miss an older trace and lose the outcome.
        occurredAt: data.occurredAt,
        idempotencyKey: data.idempotencyKey,
        data: {
          evaluationId: data.evaluationId,
          evaluatorName: data.evaluatorName,
          isGuardrail: data.isGuardrail,
          status: data.status,
          passed: data.passed,
          label: data.label,
          evaluationOccurredAt: data.evaluationOccurredAt,
          sourceEventId: data.sourceEventId,
        },
      }),
    ];
  }

  static getAggregateId(payload: RecordEvaluationOutcomeCommandData): string {
    return payload.traceId;
  }

  static getSpanAttributes(
    payload: RecordEvaluationOutcomeCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.trace.id": payload.traceId,
      "payload.evaluation.id": payload.evaluationId,
    };
  }

  static makeJobId(payload: RecordEvaluationOutcomeCommandData): string {
    return payload.idempotencyKey;
  }
}
