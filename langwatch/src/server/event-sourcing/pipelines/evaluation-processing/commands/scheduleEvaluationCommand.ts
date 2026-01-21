import { defineCommandSchema } from "../../../library";
import type { ScheduleEvaluationCommandData } from "../schemas/commands";
import { scheduleEvaluationCommandDataSchema } from "../schemas/commands";
import {
  SCHEDULE_EVALUATION_COMMAND_TYPE,
  EVALUATION_SCHEDULED_EVENT_TYPE,
  EVALUATION_SCHEDULED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type {
  EvaluationScheduledEvent,
  EvaluationScheduledEventData,
} from "../schemas/events";
import {
  BaseEvaluationCommand,
  type EvaluationCommandConfig,
} from "./baseEvaluationCommand";

const config: EvaluationCommandConfig<
  ScheduleEvaluationCommandData,
  EvaluationScheduledEventData
> = {
  eventType: EVALUATION_SCHEDULED_EVENT_TYPE,
  eventVersion: EVALUATION_SCHEDULED_EVENT_VERSION_LATEST,
  loggerName: "schedule-evaluation",
  handleLogMessage: "Handling schedule evaluation command",
  emitLogMessage: "Emitting evaluation scheduled event",
  jobIdSuffix: "schedule",
  mapToEventData: (commandData) => ({
    evaluationId: commandData.evaluationId,
    evaluatorId: commandData.evaluatorId,
    evaluatorType: commandData.evaluatorType,
    evaluatorName: commandData.evaluatorName,
    traceId: commandData.traceId,
    isGuardrail: commandData.isGuardrail,
  }),
  getLogContext: (commandData) => ({
    evaluatorId: commandData.evaluatorId,
  }),
};

/**
 * Command handler for scheduling an evaluation.
 * Emits EvaluationScheduledEvent when an evaluation job is added to the queue.
 */
export class ScheduleEvaluationCommand extends BaseEvaluationCommand<
  ScheduleEvaluationCommandData,
  EvaluationScheduledEvent,
  EvaluationScheduledEventData
> {
  static readonly schema = defineCommandSchema(
    SCHEDULE_EVALUATION_COMMAND_TYPE,
    scheduleEvaluationCommandDataSchema,
    "Command to schedule an evaluation"
  );

  protected readonly config = config;

  static getAggregateId(payload: ScheduleEvaluationCommandData): string {
    return payload.evaluationId;
  }

  static getSpanAttributes(
    payload: ScheduleEvaluationCommandData
  ): Record<string, string | number | boolean> {
    return {
      "payload.evaluation.id": payload.evaluationId,
      "payload.evaluator.id": payload.evaluatorId,
      "payload.evaluator.type": payload.evaluatorType,
      ...(payload.traceId && { "payload.trace.id": payload.traceId }),
    };
  }

  static makeJobId(payload: ScheduleEvaluationCommandData): string {
    return BaseEvaluationCommand.makeJobIdWithSuffix(payload, "schedule");
  }
}
