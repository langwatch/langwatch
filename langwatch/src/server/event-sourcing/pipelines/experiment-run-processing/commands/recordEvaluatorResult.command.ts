import type {
	Command,
	CommandHandler,
	CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { RecordEvaluatorResultCommandData } from "../schemas/commands";
import { recordEvaluatorResultCommandDataSchema } from "../schemas/commands";
import {
	EXPERIMENT_RUN_COMMAND_TYPES,
	EXPERIMENT_RUN_EVENT_TYPES,
	EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../schemas/constants";
import type {
	EvaluatorResultEvent,
	EvaluatorResultEventData,
	ExperimentRunProcessingEvent,
} from "../schemas/events";
import {
	createExperimentRunCommandHandler,
	type ExperimentRunCommandConfig,
	makeEvaluatorResultJobId,
} from "./base.command";
import { makeExperimentRunKey } from "../utils/compositeKey";

const config: ExperimentRunCommandConfig<
  RecordEvaluatorResultCommandData,
  EvaluatorResultEventData
> = {
  eventType: EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT,
  eventVersion: EXPERIMENT_RUN_EVENT_VERSIONS.EVALUATOR_RESULT,
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
    EXPERIMENT_RUN_COMMAND_TYPES.RECORD_EVALUATOR_RESULT,
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
    return makeExperimentRunKey(payload.experimentId, payload.runId);
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
