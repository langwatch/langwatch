import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { CompleteBatchEvaluationCommandData } from "../schemas/commands";
import { completeBatchEvaluationCommandDataSchema } from "../schemas/commands";
import {
  BATCH_EVALUATION_COMPLETED_EVENT_TYPE,
  BATCH_EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
  COMPLETE_BATCH_EVALUATION_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  BatchEvaluationCompletedEvent,
  BatchEvaluationCompletedEventData,
  BatchEvaluationProcessingEvent,
} from "../schemas/events";
import {
  createBatchEvaluationCommandHandler,
  type BatchEvaluationCommandConfig,
  makeJobIdWithSuffix,
} from "./base.command";

const config: BatchEvaluationCommandConfig<
  CompleteBatchEvaluationCommandData,
  BatchEvaluationCompletedEventData
> = {
  eventType: BATCH_EVALUATION_COMPLETED_EVENT_TYPE,
  eventVersion: BATCH_EVALUATION_COMPLETED_EVENT_VERSION_LATEST,
  loggerName: "complete-batch-evaluation",
  handleLogMessage: "Handling complete batch evaluation command",
  emitLogMessage: "Emitting batch evaluation completed event",
  mapToEventData: (commandData) => ({
    runId: commandData.runId,
    finishedAt: commandData.finishedAt,
    stoppedAt: commandData.stoppedAt,
  }),
  getLogContext: (commandData) => ({
    wasFinished: !!commandData.finishedAt,
    wasStopped: !!commandData.stoppedAt,
  }),
};

/**
 * Command handler for completing a batch evaluation.
 * Emits BatchEvaluationCompletedEvent when a batch evaluation run finishes.
 */
export class CompleteBatchEvaluationCommand
  implements
    CommandHandler<
      Command<CompleteBatchEvaluationCommandData>,
      BatchEvaluationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    COMPLETE_BATCH_EVALUATION_COMMAND_TYPE,
    completeBatchEvaluationCommandDataSchema,
    "Command to complete a batch evaluation",
  );

  private readonly handleCommand = createBatchEvaluationCommandHandler<
    CompleteBatchEvaluationCommandData,
    BatchEvaluationCompletedEvent,
    BatchEvaluationCompletedEventData
  >(config);

  handle(
    command: Command<CompleteBatchEvaluationCommandData>,
  ): CommandHandlerResult<BatchEvaluationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: CompleteBatchEvaluationCommandData): string {
    return payload.runId;
  }

  static getSpanAttributes(
    payload: CompleteBatchEvaluationCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.run.id": payload.runId,
      "payload.was_finished": !!payload.finishedAt,
      "payload.was_stopped": !!payload.stoppedAt,
    };
  }

  static makeJobId(payload: CompleteBatchEvaluationCommandData): string {
    return makeJobIdWithSuffix(payload, "complete");
  }
}
