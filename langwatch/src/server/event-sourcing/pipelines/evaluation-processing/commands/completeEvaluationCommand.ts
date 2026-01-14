import { createLogger } from "../../../../../utils/logger";
import type { Command, CommandHandler } from "../../../library";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../library";
import type { CompleteEvaluationCommandData } from "../schemas/commands";
import { completeEvaluationCommandDataSchema } from "../schemas/commands";
import {
  COMPLETE_EVALUATION_COMMAND_TYPE,
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type {
  EvaluationProcessingEvent,
  EvaluationCompletedEvent,
} from "../schemas/events";

const logger = createLogger("langwatch:evaluation-processing:complete-evaluation");

/**
 * Command handler for completing an evaluation.
 * Emits EvaluationCompletedEvent when evaluation execution finishes.
 */
export class CompleteEvaluationCommand
  implements
    CommandHandler<
      Command<CompleteEvaluationCommandData>,
      EvaluationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    COMPLETE_EVALUATION_COMMAND_TYPE,
    completeEvaluationCommandDataSchema,
    "Command to complete an evaluation",
  );

  async handle(
    command: Command<CompleteEvaluationCommandData>,
  ): Promise<EvaluationProcessingEvent[]> {
    const { tenantId: tenantIdStr, data: commandData } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { evaluationId, status } = commandData;

    logger.info(
      {
        tenantId,
        evaluationId,
        status,
      },
      "Handling complete evaluation command",
    );

    const event = EventUtils.createEvent<EvaluationCompletedEvent>(
      "evaluation",
      evaluationId,
      tenantId,
      EVALUATION_COMPLETED_EVENT_TYPE,
      EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
      {
        evaluationId,
        status,
        score: commandData.score,
        passed: commandData.passed,
        label: commandData.label,
        details: commandData.details,
        error: commandData.error,
      },
    );

    logger.debug(
      {
        tenantId,
        evaluationId,
        status,
        eventId: event.id,
        eventType: event.type,
      },
      "Emitting evaluation completed event",
    );

    return [event];
  }

  static getAggregateId(payload: CompleteEvaluationCommandData): string {
    return payload.evaluationId;
  }

  static getSpanAttributes(
    payload: CompleteEvaluationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.evaluation.id": payload.evaluationId,
      "payload.status": payload.status,
      ...(payload.score !== undefined && { "payload.score": payload.score }),
      ...(payload.passed !== undefined && { "payload.passed": payload.passed }),
    };
  }

  static makeJobId(payload: CompleteEvaluationCommandData): string {
    return `${payload.tenantId}:${payload.evaluationId}:complete`;
  }
}
