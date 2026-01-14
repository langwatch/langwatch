import { createLogger } from "../../../../../utils/logger";
import type { Command, CommandHandler } from "../../../library";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../library";
import type { ScheduleEvaluationCommandData } from "../schemas/commands";
import { scheduleEvaluationCommandDataSchema } from "../schemas/commands";
import {
  SCHEDULE_EVALUATION_COMMAND_TYPE,
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_SCHEDULED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type {
  EvaluationProcessingEvent,
  EvaluationScheduledEvent,
} from "../schemas/events";

const logger = createLogger("langwatch:evaluation-processing:schedule-evaluation");

/**
 * Command handler for scheduling an evaluation.
 * Emits EvaluationScheduledEvent when an evaluation job is added to the queue.
 */
export class ScheduleEvaluationCommand
  implements
    CommandHandler<
      Command<ScheduleEvaluationCommandData>,
      EvaluationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SCHEDULE_EVALUATION_COMMAND_TYPE,
    scheduleEvaluationCommandDataSchema,
    "Command to schedule an evaluation",
  );

  async handle(
    command: Command<ScheduleEvaluationCommandData>,
  ): Promise<EvaluationProcessingEvent[]> {
    const { tenantId: tenantIdStr, data: commandData } = command;
    const tenantId = createTenantId(tenantIdStr);
    const { evaluationId } = commandData;

    logger.info(
      {
        tenantId,
        evaluationId,
        evaluatorId: commandData.evaluatorId,
      },
      "Handling schedule evaluation command",
    );

    const event = EventUtils.createEvent<EvaluationScheduledEvent>(
      "evaluation",
      evaluationId,
      tenantId,
      EVALUATION_SCHEDULED_EVENT_TYPE,
      EVALUATION_SCHEDULED_EVENT_VERSION_LATEST,
      {
        evaluationId,
        evaluatorId: commandData.evaluatorId,
        evaluatorType: commandData.evaluatorType,
        evaluatorName: commandData.evaluatorName,
        traceId: commandData.traceId,
        isGuardrail: commandData.isGuardrail,
      },
    );

    logger.debug(
      {
        tenantId,
        evaluationId,
        eventId: event.id,
        eventType: event.type,
      },
      "Emitting evaluation scheduled event",
    );

    return [event];
  }

  static getAggregateId(payload: ScheduleEvaluationCommandData): string {
    return payload.evaluationId;
  }

  static getSpanAttributes(
    payload: ScheduleEvaluationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.evaluation.id": payload.evaluationId,
      "payload.evaluator.id": payload.evaluatorId,
      "payload.evaluator.type": payload.evaluatorType,
      ...(payload.traceId && { "payload.trace.id": payload.traceId }),
    };
  }

  static makeJobId(payload: ScheduleEvaluationCommandData): string {
    return `${payload.tenantId}:${payload.evaluationId}:schedule`;
  }
}
