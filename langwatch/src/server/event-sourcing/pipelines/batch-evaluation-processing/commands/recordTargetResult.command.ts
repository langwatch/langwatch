import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { RecordTargetResultCommandData } from "../schemas/commands";
import { recordTargetResultCommandDataSchema } from "../schemas/commands";
import {
  RECORD_TARGET_RESULT_COMMAND_TYPE,
  TARGET_RESULT_RECEIVED_EVENT_TYPE,
  TARGET_RESULT_RECEIVED_EVENT_VERSION_LATEST,
} from "../schemas/constants";
import type {
  BatchEvaluationProcessingEvent,
  TargetResultReceivedEvent,
  TargetResultReceivedEventData,
} from "../schemas/events";
import {
  createBatchEvaluationCommandHandler,
  type BatchEvaluationCommandConfig,
  makeResultJobId,
} from "./base.command";

const config: BatchEvaluationCommandConfig<
  RecordTargetResultCommandData,
  TargetResultReceivedEventData
> = {
  eventType: TARGET_RESULT_RECEIVED_EVENT_TYPE,
  eventVersion: TARGET_RESULT_RECEIVED_EVENT_VERSION_LATEST,
  loggerName: "record-target-result",
  handleLogMessage: "Handling record target result command",
  emitLogMessage: "Emitting target result received event",
  mapToEventData: (commandData) => ({
    runId: commandData.runId,
    experimentId: commandData.experimentId,
    index: commandData.index,
    targetId: commandData.targetId,
    entry: commandData.entry,
    predicted: commandData.predicted,
    cost: commandData.cost,
    duration: commandData.duration,
    error: commandData.error,
    traceId: commandData.traceId,
  }),
  getLogContext: (commandData) => ({
    index: commandData.index,
    targetId: commandData.targetId,
    hasError: !!commandData.error,
  }),
};

/**
 * Command handler for recording a target result.
 * Emits TargetResultReceivedEvent when a target execution completes for a row.
 */
export class RecordTargetResultCommand
  implements
    CommandHandler<
      Command<RecordTargetResultCommandData>,
      BatchEvaluationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    RECORD_TARGET_RESULT_COMMAND_TYPE,
    recordTargetResultCommandDataSchema,
    "Command to record a target result",
  );

  private readonly handleCommand = createBatchEvaluationCommandHandler<
    RecordTargetResultCommandData,
    TargetResultReceivedEvent,
    TargetResultReceivedEventData
  >(config);

  handle(
    command: Command<RecordTargetResultCommandData>,
  ): CommandHandlerResult<BatchEvaluationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: RecordTargetResultCommandData): string {
    return payload.runId;
  }

  static getSpanAttributes(
    payload: RecordTargetResultCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.run.id": payload.runId,
      "payload.index": payload.index,
      "payload.target.id": payload.targetId,
      ...(payload.traceId && { "payload.trace.id": payload.traceId }),
    };
  }

  static makeJobId(payload: RecordTargetResultCommandData): string {
    return makeResultJobId(payload, "target");
  }
}
