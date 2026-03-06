import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { StartScenarioCommandData } from "../schemas/commands";
import { startScenarioCommandDataSchema } from "../schemas/commands";
import {
  SUITE_RUN_COMMAND_TYPES,
  SUITE_RUN_EVENT_VERSIONS,
  SUITE_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SuiteRunProcessingEvent,
  SuiteRunScenarioStartedEvent,
  SuiteRunScenarioStartedEventData,
} from "../schemas/events";
import { makeSuiteRunKey } from "../utils/compositeKey";
import {
  createSuiteRunCommandHandler,
  type SuiteRunCommandConfig,
} from "./base.command";

const config: SuiteRunCommandConfig<
  StartScenarioCommandData,
  SuiteRunScenarioStartedEventData
> = {
  eventType: SUITE_RUN_EVENT_TYPES.SCENARIO_STARTED,
  eventVersion: SUITE_RUN_EVENT_VERSIONS.SCENARIO_STARTED,
  loggerName: "start-scenario",
  handleLogMessage: "Handling start scenario command",
  emitLogMessage: "Emitting suite run scenario started event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    targetReferenceId: commandData.targetReferenceId,
    targetType: commandData.targetType,
    batchRunId: commandData.batchRunId,
  }),
  getLogContext: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
  }),
};

/**
 * Command handler for starting an individual scenario within a suite run.
 * Emits SuiteRunScenarioStartedEvent when a scenario begins.
 */
export class StartScenarioCommand
  implements
    CommandHandler<
      Command<StartScenarioCommandData>,
      SuiteRunProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SUITE_RUN_COMMAND_TYPES.START_SCENARIO,
    startScenarioCommandDataSchema,
    "Command to start a scenario in a suite run",
  );

  private readonly handleCommand = createSuiteRunCommandHandler<
    StartScenarioCommandData,
    SuiteRunScenarioStartedEvent,
    SuiteRunScenarioStartedEventData
  >(config);

  handle(
    command: Command<StartScenarioCommandData>,
  ): CommandHandlerResult<SuiteRunProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: StartScenarioCommandData): string {
    return makeSuiteRunKey(payload.suiteId, payload.batchRunId);
  }

  static getSpanAttributes(
    payload: StartScenarioCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.suite.id": payload.suiteId,
      "payload.batchRun.id": payload.batchRunId,
      "payload.scenarioRun.id": payload.scenarioRunId,
    };
  }

  static makeJobId(payload: StartScenarioCommandData): string {
    return `${payload.tenantId}:${payload.batchRunId}:${payload.scenarioRunId}:started`;
  }
}
