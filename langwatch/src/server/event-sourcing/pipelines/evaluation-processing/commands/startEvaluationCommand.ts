import { defineCommandSchema } from "../../../library";
import type { StartEvaluationCommandData } from "../schemas/commands";
import { startEvaluationCommandDataSchema } from "../schemas/commands";
import {
  START_EVALUATION_COMMAND_TYPE,
  EVALUATION_STARTED_EVENT_TYPE,
  EVALUATION_STARTED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type {
  EvaluationStartedEvent,
  EvaluationStartedEventData,
} from "../schemas/events";
import {
  BaseEvaluationCommand,
  type EvaluationCommandConfig,
} from "./baseEvaluationCommand";

const config: EvaluationCommandConfig<
  StartEvaluationCommandData,
  EvaluationStartedEventData
> = {
  eventType: EVALUATION_STARTED_EVENT_TYPE,
  eventVersion: EVALUATION_STARTED_EVENT_VERSION_LATEST,
  loggerName: "start-evaluation",
  handleLogMessage: "Handling start evaluation command",
  emitLogMessage: "Emitting evaluation started event",
  jobIdSuffix: "start",
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
 * Command handler for starting an evaluation.
 * Emits EvaluationStartedEvent when evaluation execution begins.
 */
export class StartEvaluationCommand extends BaseEvaluationCommand<
  StartEvaluationCommandData,
  EvaluationStartedEvent,
  EvaluationStartedEventData
> {
  static readonly schema = defineCommandSchema(
    START_EVALUATION_COMMAND_TYPE,
    startEvaluationCommandDataSchema,
    "Command to start an evaluation"
  );

  protected readonly config = config;

  static getAggregateId(payload: StartEvaluationCommandData): string {
    return payload.evaluationId;
  }

  static getSpanAttributes(
    payload: StartEvaluationCommandData
  ): Record<string, string | number | boolean> {
    return {
      "payload.evaluation.id": payload.evaluationId,
      "payload.evaluator.id": payload.evaluatorId,
      "payload.evaluator.type": payload.evaluatorType,
      ...(payload.traceId && { "payload.trace.id": payload.traceId }),
    };
  }

  static makeJobId(payload: StartEvaluationCommandData): string {
    return BaseEvaluationCommand.makeJobIdWithSuffix(payload, "start");
  }
}
