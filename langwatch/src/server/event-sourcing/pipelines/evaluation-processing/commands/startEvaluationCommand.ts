import { createLogger } from "../../../../../utils/logger";
import type { Command, CommandHandler } from "../../../library";
import { createTenantId, defineCommandSchema, EventUtils } from "../../../library";
import type { StartEvaluationCommandData } from "../schemas/commands";
import { startEvaluationCommandDataSchema } from "../schemas/commands";
import {
  START_EVALUATION_COMMAND_TYPE,
  EVALUATION_STARTED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type {
  EvaluationProcessingEvent,
  EvaluationStartedEvent,
} from "../schemas/events";

const logger = createLogger("langwatch:evaluation-processing:start-evaluation");

/**
 * Command handler for starting an evaluation.
 * Emits EvaluationStartedEvent when evaluation execution begins.
 */
export class StartEvaluationCommand
  implements
    CommandHandler<
      Command<StartEvaluationCommandData>,
      EvaluationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    START_EVALUATION_COMMAND_TYPE,
    startEvaluationCommandDataSchema,
    "Command to start an evaluation",
  );

  async handle(
    command: Command<StartEvaluationCommandData>,
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
      "Handling start evaluation command",
    );

    const event = EventUtils.createEvent<EvaluationStartedEvent>(
      "evaluation",
      evaluationId,
      tenantId,
      EVALUATION_STARTED_EVENT_TYPE,
      EVALUATION_STARTED_EVENT_VERSION_LATEST,
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
      "Emitting evaluation started event",
    );

    return [event];
  }

  static getAggregateId(payload: StartEvaluationCommandData): string {
    return payload.evaluationId;
  }

  static getSpanAttributes(
    payload: StartEvaluationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.evaluation.id": payload.evaluationId,
      "payload.evaluator.id": payload.evaluatorId,
      "payload.evaluator.type": payload.evaluatorType,
      ...(payload.traceId && { "payload.trace.id": payload.traceId }),
    };
  }

  static makeJobId(payload: StartEvaluationCommandData): string {
    return `${payload.tenantId}:${payload.evaluationId}:start`;
  }
}
