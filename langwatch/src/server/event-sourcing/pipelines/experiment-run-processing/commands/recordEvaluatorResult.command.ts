import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { RecordEvaluatorResultCommandData } from "../schemas/commands";
import { recordEvaluatorResultCommandDataSchema } from "../schemas/commands";
import {
  EVALUATOR_RESULT_EVENT_TYPE,
  EVALUATOR_RESULT_EVENT_VERSION_LATEST,
  RECORD_EVALUATOR_RESULT_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  ExperimentRunProcessingEvent,
  EvaluatorResultEvent,
  EvaluatorResultEventData,
} from "../schemas/events";
import {
  createExperimentRunCommandHandler,
  type ExperimentRunCommandConfig,
  makeEvaluatorResultJobId,
} from "./base.command";

const config: ExperimentRunCommandConfig<
  RecordEvaluatorResultCommandData,
  EvaluatorResultEventData
> = {
  eventType: EVALUATOR_RESULT_EVENT_TYPE,
  eventVersion: EVALUATOR_RESULT_EVENT_VERSION_LATEST,
  loggerName: "record-evaluator-result",
  handleLogMessage: "Handling record evaluator result command",
  emitLogMessage: "Emitting evaluator result event",
  mapToEventData: (commandData) => ({
    runId: commandData.runId,
    experimentId: commandData.experimentId,
    index: commandData.index,
    targetId: commandData.targetId,
    evaluatorId: commandData.evaluatorId,
    evaluatorName: commandData.evaluatorName,
    status: commandData.status,
    score: commandData.score,
    label: commandData.label,
    passed: commandData.passed,
    details: commandData.details,
    cost: commandData.cost,
  }),
  getLogContext: (commandData) => ({
    index: commandData.index,
    targetId: commandData.targetId,
    evaluatorId: commandData.evaluatorId,
    status: commandData.status,
  }),
};

/**
 * Command handler for recording an evaluator result.
 * Emits EvaluatorResultEvent when an evaluator completes for a row.
 */
export class RecordEvaluatorResultCommand
  implements
    CommandHandler<
      Command<RecordEvaluatorResultCommandData>,
      ExperimentRunProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    RECORD_EVALUATOR_RESULT_COMMAND_TYPE,
    recordEvaluatorResultCommandDataSchema,
    "Command to record an evaluator result",
  );

  private readonly handleCommand = createExperimentRunCommandHandler<
    RecordEvaluatorResultCommandData,
    EvaluatorResultEvent,
    EvaluatorResultEventData
  >(config);

  handle(
    command: Command<RecordEvaluatorResultCommandData>,
  ): CommandHandlerResult<ExperimentRunProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: RecordEvaluatorResultCommandData): string {
    return payload.runId;
  }

  static getSpanAttributes(
    payload: RecordEvaluatorResultCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.run.id": payload.runId,
      "payload.index": payload.index,
      "payload.target.id": payload.targetId,
      "payload.evaluator.id": payload.evaluatorId,
      "payload.status": payload.status,
      ...(payload.score !== undefined &&
        payload.score !== null && { "payload.score": payload.score }),
    };
  }

  static makeJobId(payload: RecordEvaluatorResultCommandData): string {
    return makeEvaluatorResultJobId(payload, "evaluator");
  }
}
