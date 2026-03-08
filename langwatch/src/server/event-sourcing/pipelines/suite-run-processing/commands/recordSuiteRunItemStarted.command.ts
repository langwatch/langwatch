import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { RecordSuiteRunItemStartedCommandData } from "../schemas/commands";
import { recordSuiteRunItemStartedCommandDataSchema } from "../schemas/commands";
import {
  SUITE_RUN_COMMAND_TYPES,
  SUITE_RUN_EVENT_VERSIONS,
  SUITE_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SuiteRunProcessingEvent,
  SuiteRunItemStartedEvent,
  SuiteRunItemStartedEventData,
} from "../schemas/events";
import {
  createSuiteRunCommandHandler,
  makeJobIdWithSuffix,
  type SuiteRunCommandConfig,
} from "./base.command";

const config: SuiteRunCommandConfig<
  RecordSuiteRunItemStartedCommandData,
  SuiteRunItemStartedEventData
> = {
  eventType: SUITE_RUN_EVENT_TYPES.ITEM_STARTED,
  eventVersion: SUITE_RUN_EVENT_VERSIONS.ITEM_STARTED,
  loggerName: "record-item-started",
  handleLogMessage: "Handling record suite run item started command",
  emitLogMessage: "Emitting suite run item started event",
  mapToEventData: (commandData) => ({
    batchRunId: commandData.batchRunId,
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
  }),
  getLogContext: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
  }),
  makeIdempotencyKey: (commandData) =>
    `${commandData.tenantId}:${commandData.batchRunId}:${commandData.scenarioRunId}:itemStarted`,
};

export class RecordSuiteRunItemStartedCommand
  implements
    CommandHandler<
      Command<RecordSuiteRunItemStartedCommandData>,
      SuiteRunProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SUITE_RUN_COMMAND_TYPES.RECORD_ITEM_STARTED,
    recordSuiteRunItemStartedCommandDataSchema,
    "Command to record a suite run item started",
  );

  private readonly handleCommand = createSuiteRunCommandHandler<
    RecordSuiteRunItemStartedCommandData,
    SuiteRunItemStartedEvent,
    SuiteRunItemStartedEventData
  >(config);

  handle(
    command: Command<RecordSuiteRunItemStartedCommandData>,
  ): CommandHandlerResult<SuiteRunProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: RecordSuiteRunItemStartedCommandData): string {
    return payload.batchRunId;
  }

  static getSpanAttributes(
    payload: RecordSuiteRunItemStartedCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.batchRun.id": payload.batchRunId,
      "payload.scenarioRun.id": payload.scenarioRunId,
    };
  }

  static makeJobId(payload: RecordSuiteRunItemStartedCommandData): string {
    return makeJobIdWithSuffix(payload, `${payload.scenarioRunId}:itemStarted`);
  }
}
