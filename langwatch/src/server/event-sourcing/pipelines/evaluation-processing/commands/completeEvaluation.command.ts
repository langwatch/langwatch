import type {
	Command,
	CommandHandler,
	CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
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
	EvaluationProcessingEvent,
} from "../schemas/events";
import {
	createEvaluationCommandHandler,
	type EvaluationCommandConfig,
	makeJobIdWithSuffix,
} from "./base.command";

const config: EvaluationCommandConfig<
  CompleteEvaluationCommandData,
  EvaluationCompletedEventData
> = {
  eventType: EVALUATION_COMPLETED_EVENT_TYPE,
  eventVersion: EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
  loggerName: "complete-evaluation",
  handleLogMessage: "Handling complete evaluation command",
  emitLogMessage: "Emitting evaluation completed event",
  mapToEventData: (commandData) => ({
    evaluationId: commandData.evaluationId,
    status: commandData.status,
    score: commandData.score,
    passed: commandData.passed,
    label: commandData.label,
    details: commandData.details,
    error: commandData.error,
    costId: commandData.costId ?? null,
  }),
  getLogContext: (commandData) => ({
    status: commandData.status,
  }),
};

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

  private readonly handleCommand = createEvaluationCommandHandler<
    CompleteEvaluationCommandData,
    EvaluationCompletedEvent,
    EvaluationCompletedEventData
  >(config);

  handle(
    command: Command<CompleteEvaluationCommandData>,
  ): CommandHandlerResult<EvaluationProcessingEvent> {
    return this.handleCommand(command);
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
      ...(payload.score != null && { "payload.score": payload.score }),
      ...(payload.passed != null && { "payload.passed": payload.passed }),
    };
  }

  static makeJobId(payload: CompleteEvaluationCommandData): string {
    return makeJobIdWithSuffix(payload, "complete");
  }
}
