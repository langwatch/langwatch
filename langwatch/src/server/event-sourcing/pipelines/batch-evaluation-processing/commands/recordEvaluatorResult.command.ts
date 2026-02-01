import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { RecordEvaluatorResultCommandData } from "../schemas/commands";
import { recordEvaluatorResultCommandDataSchema } from "../schemas/commands";
import {
  EVALUATOR_RESULT_RECEIVED_EVENT_TYPE,
  EVALUATOR_RESULT_RECEIVED_EVENT_VERSION_LATEST,
  RECORD_EVALUATOR_RESULT_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  BatchEvaluationProcessingEvent,
  EvaluatorResultReceivedEvent,
  EvaluatorResultReceivedEventData,
} from "../schemas/events";
import {
  createBatchEvaluationCommandHandler,
  type BatchEvaluationCommandConfig,
  makeEvaluatorResultJobId,
} from "./base.command";

const config: BatchEvaluationCommandConfig<
  RecordEvaluatorResultCommandData,
  EvaluatorResultReceivedEventData
> = {
  eventType: EVALUATOR_RESULT_RECEIVED_EVENT_TYPE,
  eventVersion: EVALUATOR_RESULT_RECEIVED_EVENT_VERSION_LATEST,
  loggerName: "record-evaluator-result",
  handleLogMessage: "Handling record evaluator result command",
  emitLogMessage: "Emitting evaluator result received event",
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
 * Emits EvaluatorResultReceivedEvent when an evaluator completes for a row.
 */
export class RecordEvaluatorResultCommand
  implements
    CommandHandler<
      Command<RecordEvaluatorResultCommandData>,
      BatchEvaluationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    RECORD_EVALUATOR_RESULT_COMMAND_TYPE,
    recordEvaluatorResultCommandDataSchema,
    "Command to record an evaluator result",
  );

  private readonly handleCommand = createBatchEvaluationCommandHandler<
    RecordEvaluatorResultCommandData,
    EvaluatorResultReceivedEvent,
    EvaluatorResultReceivedEventData
  >(config);

  handle(
    command: Command<RecordEvaluatorResultCommandData>,
  ): CommandHandlerResult<BatchEvaluationProcessingEvent> {
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
