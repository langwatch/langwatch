import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { StartSuiteRunCommandData } from "../schemas/commands";
import { startSuiteRunCommandDataSchema } from "../schemas/commands";
import {
  SUITE_RUN_COMMAND_TYPES,
  SUITE_RUN_EVENT_VERSIONS,
  SUITE_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SuiteRunProcessingEvent,
  SuiteRunStartedEvent,
  SuiteRunStartedEventData,
} from "../schemas/events";
import {
  createSuiteRunCommandHandler,
  type SuiteRunCommandConfig,
} from "./base.command";

const config: SuiteRunCommandConfig<
  StartSuiteRunCommandData,
  SuiteRunStartedEventData
> = {
  eventType: SUITE_RUN_EVENT_TYPES.STARTED,
  eventVersion: SUITE_RUN_EVENT_VERSIONS.STARTED,
  loggerName: "start-suite-run",
  handleLogMessage: "Handling start suite run command",
  emitLogMessage: "Emitting suite run started event",
  mapToEventData: (commandData) => ({
    batchRunId: commandData.batchRunId,
    scenarioSetId: commandData.scenarioSetId,
    suiteId: commandData.suiteId,
    total: commandData.total,
    scenarioIds: commandData.scenarioIds,
    targetIds: commandData.targetIds,
  }),
  getLogContext: (commandData) => ({
    suiteId: commandData.suiteId,
    scenarioSetId: commandData.scenarioSetId,
    total: commandData.total,
  }),
  makeIdempotencyKey: (commandData) =>
    `${commandData.tenantId}:${commandData.batchRunId}:${commandData.idempotencyKey}`,
};

/**
 * Command handler for starting a suite run.
 * Emits SuiteRunStartedEvent when a suite run begins.
 *
 * The client-provided idempotencyKey is used in both the event idempotency key
 * and makeJobId to prevent double submits.
 */
export class StartSuiteRunCommand
  implements
    CommandHandler<
      Command<StartSuiteRunCommandData>,
      SuiteRunProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SUITE_RUN_COMMAND_TYPES.START,
    startSuiteRunCommandDataSchema,
    "Command to start a suite run",
  );

  private readonly handleCommand = createSuiteRunCommandHandler<
    StartSuiteRunCommandData,
    SuiteRunStartedEvent,
    SuiteRunStartedEventData
  >(config);

  handle(
    command: Command<StartSuiteRunCommandData>,
  ): CommandHandlerResult<SuiteRunProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: StartSuiteRunCommandData): string {
    return payload.batchRunId;
  }

  static getSpanAttributes(
    payload: StartSuiteRunCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.batchRun.id": payload.batchRunId,
      "payload.suite.id": payload.suiteId,
      "payload.total": payload.total,
    };
  }

  static makeJobId(payload: StartSuiteRunCommandData): string {
    return `${payload.tenantId}:${payload.batchRunId}:${payload.idempotencyKey}`;
  }
}
