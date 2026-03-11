import type { Command, CommandHandler, CommandHandlerResult } from "../../../";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../";
import { createLogger } from "../../../../../utils/logger/server";
import type { ReportEvaluationCommandData } from "../schemas/commands";
import { reportEvaluationCommandDataSchema } from "../schemas/commands";
import {
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
  EVALUATION_STARTED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_VERSION_LATEST,
  REPORT_EVALUATION_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  EvaluationCompletedEvent,
  EvaluationProcessingEvent,
  EvaluationStartedEvent,
} from "../schemas/events";
import { makeJobIdWithSuffix } from "./base.command";

const logger = createLogger(
  "langwatch:evaluation-processing:report-evaluation",
);

/**
 * Command handler for reporting a custom SDK evaluation atomically.
 *
 * Unlike startEvaluation + completeEvaluation (two separate commands),
 * this handler emits BOTH EvaluationStartedEvent and EvaluationCompletedEvent
 * from a single command. This avoids ClickHouse replica lag where the
 * completeEvaluation fold reads stale state because the startEvaluation
 * write hasn't replicated yet.
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
    "Command to report a custom SDK evaluation (start + complete atomically)",
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

    const startedEvent = EventUtils.createEvent<EvaluationStartedEvent>({
      aggregateType: "evaluation",
      aggregateId: data.evaluationId,
      tenantId,
      type: EVALUATION_STARTED_EVENT_TYPE,
      version: EVALUATION_STARTED_EVENT_VERSION_LATEST,
      data: {
        evaluationId: data.evaluationId,
        evaluatorId: data.evaluatorId,
        evaluatorType: data.evaluatorType,
        evaluatorName: data.evaluatorName,
        traceId: data.traceId,
        isGuardrail: data.isGuardrail,
      },
      occurredAt: data.occurredAt,
      idempotencyKey: `${data.tenantId}:${data.evaluationId}:started`,
    });

    const completedEvent = EventUtils.createEvent<EvaluationCompletedEvent>({
      aggregateType: "evaluation",
      aggregateId: data.evaluationId,
      tenantId,
      type: EVALUATION_COMPLETED_EVENT_TYPE,
      version: EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
      data: {
        evaluationId: data.evaluationId,
        status: data.status,
        score: data.score ?? null,
        passed: data.passed ?? null,
        label: data.label ?? null,
        details: data.details ?? null,
        error: data.error ?? null,
        errorDetails: null,
        costId: null,
      },
      occurredAt: data.occurredAt + 1,
      idempotencyKey: `${data.tenantId}:${data.evaluationId}:completed`,
    });

    logger.debug(
      {
        tenantId,
        evaluationId: data.evaluationId,
        eventCount: 2,
      },
      "Emitting evaluation started + completed events",
    );

    return Promise.resolve([startedEvent, completedEvent]);
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
