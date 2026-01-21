import { defineCommandSchema } from "../../../library";
import type { CompleteEvaluationCommandData } from "../schemas/commands";
import { completeEvaluationCommandDataSchema } from "../schemas/commands";
import {
  COMPLETE_EVALUATION_COMMAND_TYPE,
  EVALUATION_COMPLETED_EVENT_TYPE,
  EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type {
  EvaluationCompletedEvent,
  EvaluationCompletedEventData,
} from "../schemas/events";
import {
  BaseEvaluationCommand,
  type EvaluationCommandConfig,
} from "./baseEvaluationCommand";

const config: EvaluationCommandConfig<
  CompleteEvaluationCommandData,
  EvaluationCompletedEventData
> = {
  eventType: EVALUATION_COMPLETED_EVENT_TYPE,
  eventVersion: EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
  loggerName: "complete-evaluation",
  handleLogMessage: "Handling complete evaluation command",
  emitLogMessage: "Emitting evaluation completed event",
  jobIdSuffix: "complete",
  mapToEventData: (commandData) => ({
    evaluationId: commandData.evaluationId,
    status: commandData.status,
    score: commandData.score,
    passed: commandData.passed,
    label: commandData.label,
    details: commandData.details,
    error: commandData.error,
  }),
  getLogContext: (commandData) => ({
    status: commandData.status,
  }),
};

/**
 * Command handler for completing an evaluation.
 * Emits EvaluationCompletedEvent when evaluation execution finishes.
 */
export class CompleteEvaluationCommand extends BaseEvaluationCommand<
  CompleteEvaluationCommandData,
  EvaluationCompletedEvent,
  EvaluationCompletedEventData
> {
  static readonly schema = defineCommandSchema(
    COMPLETE_EVALUATION_COMMAND_TYPE,
    completeEvaluationCommandDataSchema,
    "Command to complete an evaluation"
  );

  protected readonly config = config;

  static getAggregateId(payload: CompleteEvaluationCommandData): string {
    return payload.evaluationId;
  }

  static getSpanAttributes(
    payload: CompleteEvaluationCommandData
  ): Record<string, string | number | boolean> {
    return {
      "payload.evaluation.id": payload.evaluationId,
      "payload.status": payload.status,
      ...(payload.score !== undefined && { "payload.score": payload.score }),
      ...(payload.passed !== undefined && { "payload.passed": payload.passed }),
    };
  }

  static makeJobId(payload: CompleteEvaluationCommandData): string {
    return BaseEvaluationCommand.makeJobIdWithSuffix(payload, "complete");
  }
}
