import type {
	Command,
	CommandHandler,
	CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { RecordTargetResultCommandData } from "../schemas/commands";
import { recordTargetResultCommandDataSchema } from "../schemas/commands";
import {
	EXPERIMENT_RUN_COMMAND_TYPES,
	EXPERIMENT_RUN_EVENT_TYPES,
	EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../schemas/constants";
import type {
	ExperimentRunProcessingEvent,
	TargetResultEvent,
	TargetResultEventData,
} from "../schemas/events";
import {
	createExperimentRunCommandHandler,
	type ExperimentRunCommandConfig,
	makeResultJobId,
} from "./base.command";

const config: ExperimentRunCommandConfig<
  RecordTargetResultCommandData,
  TargetResultEventData
> = {
  eventType: EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT,
  eventVersion: EXPERIMENT_RUN_EVENT_VERSIONS.TARGET_RESULT,
  loggerName: "record-target-result",
  handleLogMessage: "Handling record target result command",
  emitLogMessage: "Emitting target result event",
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
 * Emits TargetResultEvent when a target execution completes for a row.
 */
export class RecordTargetResultCommand
  implements
    CommandHandler<
      Command<RecordTargetResultCommandData>,
      ExperimentRunProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    EXPERIMENT_RUN_COMMAND_TYPES.RECORD_TARGET_RESULT,
    recordTargetResultCommandDataSchema,
    "Command to record a target result",
  );

  private readonly handleCommand = createExperimentRunCommandHandler<
    RecordTargetResultCommandData,
    TargetResultEvent,
    TargetResultEventData
  >(config);

  handle(
    command: Command<RecordTargetResultCommandData>,
  ): CommandHandlerResult<ExperimentRunProcessingEvent> {
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
