import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { RecordScenarioResultCommandData } from "../schemas/commands";
import { recordScenarioResultCommandDataSchema } from "../schemas/commands";
import {
  SUITE_RUN_COMMAND_TYPES,
  SUITE_RUN_EVENT_VERSIONS,
  SUITE_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SuiteRunProcessingEvent,
  SuiteRunScenarioResultEvent,
  SuiteRunScenarioResultEventData,
} from "../schemas/events";
import { makeSuiteRunKey } from "../utils/compositeKey";
import {
  createSuiteRunCommandHandler,
  type SuiteRunCommandConfig,
} from "./base.command";

const config: SuiteRunCommandConfig<
  RecordScenarioResultCommandData,
  SuiteRunScenarioResultEventData
> = {
  eventType: SUITE_RUN_EVENT_TYPES.SCENARIO_RESULT,
  eventVersion: SUITE_RUN_EVENT_VERSIONS.SCENARIO_RESULT,
  loggerName: "record-scenario-result",
  handleLogMessage: "Handling record scenario result command",
  emitLogMessage: "Emitting suite run scenario result event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    targetReferenceId: commandData.targetReferenceId,
    targetType: commandData.targetType,
    status: commandData.status,
    verdict: commandData.verdict,
    durationMs: commandData.durationMs,
    batchRunId: commandData.batchRunId,
  }),
  getLogContext: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    status: commandData.status,
  }),
};

/**
 * Command handler for recording a scenario result within a suite run.
 * Emits SuiteRunScenarioResultEvent when a scenario completes.
 */
export class RecordScenarioResultCommand
  implements
    CommandHandler<
      Command<RecordScenarioResultCommandData>,
      SuiteRunProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SUITE_RUN_COMMAND_TYPES.RECORD_SCENARIO_RESULT,
    recordScenarioResultCommandDataSchema,
    "Command to record a scenario result in a suite run",
  );

  private readonly handleCommand = createSuiteRunCommandHandler<
    RecordScenarioResultCommandData,
    SuiteRunScenarioResultEvent,
    SuiteRunScenarioResultEventData
  >(config);

  handle(
    command: Command<RecordScenarioResultCommandData>,
  ): CommandHandlerResult<SuiteRunProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: RecordScenarioResultCommandData): string {
    return makeSuiteRunKey(payload.suiteId, payload.batchRunId);
  }

  static getSpanAttributes(
    payload: RecordScenarioResultCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.suite.id": payload.suiteId,
      "payload.batchRun.id": payload.batchRunId,
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.status": payload.status,
    };
  }

  static makeJobId(payload: RecordScenarioResultCommandData): string {
    return `${payload.tenantId}:${payload.batchRunId}:${payload.scenarioRunId}:result`;
  }
}
