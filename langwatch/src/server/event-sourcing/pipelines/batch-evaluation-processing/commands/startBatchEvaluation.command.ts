import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { StartBatchEvaluationCommandData } from "../schemas/commands";
import { startBatchEvaluationCommandDataSchema } from "../schemas/commands";
import {
  BATCH_EVALUATION_STARTED_EVENT_TYPE,
  BATCH_EVALUATION_STARTED_EVENT_VERSION_LATEST,
  START_BATCH_EVALUATION_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  BatchEvaluationProcessingEvent,
  BatchEvaluationStartedEvent,
  BatchEvaluationStartedEventData,
} from "../schemas/events";
import {
  createBatchEvaluationCommandHandler,
  type BatchEvaluationCommandConfig,
  makeJobIdWithSuffix,
} from "./base.command";

const config: BatchEvaluationCommandConfig<
  StartBatchEvaluationCommandData,
  BatchEvaluationStartedEventData
> = {
  eventType: BATCH_EVALUATION_STARTED_EVENT_TYPE,
  eventVersion: BATCH_EVALUATION_STARTED_EVENT_VERSION_LATEST,
  loggerName: "start-batch-evaluation",
  handleLogMessage: "Handling start batch evaluation command",
  emitLogMessage: "Emitting batch evaluation started event",
  mapToEventData: (commandData) => ({
    runId: commandData.runId,
    experimentId: commandData.experimentId,
    workflowVersionId: commandData.workflowVersionId,
    total: commandData.total,
    targets: commandData.targets,
  }),
  getLogContext: (commandData) => ({
    experimentId: commandData.experimentId,
    total: commandData.total,
  }),
};

/**
 * Command handler for starting a batch evaluation.
 * Emits BatchEvaluationStartedEvent when a batch evaluation run begins.
 */
export class StartBatchEvaluationCommand
  implements
    CommandHandler<
      Command<StartBatchEvaluationCommandData>,
      BatchEvaluationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    START_BATCH_EVALUATION_COMMAND_TYPE,
    startBatchEvaluationCommandDataSchema,
    "Command to start a batch evaluation",
  );

  private readonly handleCommand = createBatchEvaluationCommandHandler<
    StartBatchEvaluationCommandData,
    BatchEvaluationStartedEvent,
    BatchEvaluationStartedEventData
  >(config);

  handle(
    command: Command<StartBatchEvaluationCommandData>,
  ): CommandHandlerResult<BatchEvaluationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: StartBatchEvaluationCommandData): string {
    return payload.runId;
  }

  static getSpanAttributes(
    payload: StartBatchEvaluationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.run.id": payload.runId,
      "payload.experiment.id": payload.experimentId,
      "payload.total": payload.total,
    };
  }

  static makeJobId(payload: StartBatchEvaluationCommandData): string {
    return makeJobIdWithSuffix(payload, "start");
  }
}
