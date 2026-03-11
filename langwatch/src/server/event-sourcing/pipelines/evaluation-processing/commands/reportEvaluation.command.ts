import type { Command, CommandHandler, CommandHandlerResult } from "../../../";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { ReportEvaluationCommandData } from "../schemas/commands";
import { reportEvaluationCommandDataSchema } from "../schemas/commands";
import {
  EVALUATION_REPORTED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_VERSION_LATEST,
  REPORT_EVALUATION_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  EvaluationProcessingEvent,
  EvaluationReportedEvent,
} from "../schemas/events";
import { makeJobIdWithSuffix } from "./base.command";

const logger = createLogger(
  "langwatch:evaluation-processing:report-evaluation",
);

/**
 * Command handler for reporting a custom SDK evaluation atomically.
 *
 * Emits a single EvaluationReportedEvent carrying ALL evaluation data
 * (evaluator identity + results). This avoids ClickHouse replica lag
 * that occurs when two separate events are dispatched as separate jobs.
 */
export class ReportEvaluationCommand
  implements
    CommandHandler<
      Command<ReportEvaluationCommandData>,
      EvaluationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    REPORT_EVALUATION_COMMAND_TYPE,
    reportEvaluationCommandDataSchema,
    "Command to report a custom SDK evaluation (single atomic event)",
  );

  handle(
    command: Command<ReportEvaluationCommandData>,
  ): CommandHandlerResult<EvaluationProcessingEvent> {
    const { tenantId: tenantIdStr, data } = command;
    const tenantId = createTenantId(tenantIdStr);

    logger.debug(
      {
        tenantId,
        evaluationId: data.evaluationId,
        evaluatorId: data.evaluatorId,
      },
      "Handling report evaluation command",
    );

    const event = EventUtils.createEvent<EvaluationReportedEvent>({
      aggregateType: "evaluation",
      aggregateId: data.evaluationId,
      tenantId,
      type: EVALUATION_REPORTED_EVENT_TYPE,
      version: EVALUATION_REPORTED_EVENT_VERSION_LATEST,
      data: {
        evaluationId: data.evaluationId,
        evaluatorId: data.evaluatorId,
        evaluatorType: data.evaluatorType,
        evaluatorName: data.evaluatorName,
        traceId: data.traceId,
        isGuardrail: data.isGuardrail,
        status: data.status,
        score: data.score ?? null,
        passed: data.passed ?? null,
        label: data.label ?? null,
        details: data.details ?? null,
        error: data.error ?? null,
      },
      occurredAt: data.occurredAt,
      idempotencyKey: `${data.tenantId}:${data.evaluationId}:reported`,
    });

    logger.debug(
      {
        tenantId,
        evaluationId: data.evaluationId,
        eventId: event.id,
        eventType: event.type,
      },
      "Emitting evaluation reported event",
    );

    return Promise.resolve([event]);
  }

  static getAggregateId(payload: ReportEvaluationCommandData): string {
    return payload.evaluationId;
  }

  static getSpanAttributes(
    payload: ReportEvaluationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.evaluation.id": payload.evaluationId,
      "payload.evaluator.id": payload.evaluatorId,
      "payload.evaluator.type": payload.evaluatorType,
      "payload.status": payload.status,
    };
  }

  static makeJobId(payload: ReportEvaluationCommandData): string {
    return makeJobIdWithSuffix(payload, "report");
  }
}
