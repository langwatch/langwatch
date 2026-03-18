import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { CompleteSuiteRunItemCommandData } from "../schemas/commands";
import { completeSuiteRunItemCommandDataSchema } from "../schemas/commands";
import {
  SUITE_RUN_COMMAND_TYPES,
  SUITE_RUN_EVENT_VERSIONS,
  SUITE_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
  SuiteRunProcessingEvent,
  SuiteRunItemCompletedEvent,
  SuiteRunItemCompletedEventData,
} from "../schemas/events";
import {
  createSuiteRunCommandHandler,
  makeJobIdWithSuffix,
  type SuiteRunCommandConfig,
} from "./base.command";

const config: SuiteRunCommandConfig<
  CompleteSuiteRunItemCommandData,
  SuiteRunItemCompletedEventData
> = {
  eventType: SUITE_RUN_EVENT_TYPES.ITEM_COMPLETED,
  eventVersion: SUITE_RUN_EVENT_VERSIONS.ITEM_COMPLETED,
  loggerName: "complete-item",
  handleLogMessage: "Handling complete suite run item command",
  emitLogMessage: "Emitting suite run item completed event",
  mapToEventData: (commandData) => ({
    batchRunId: commandData.batchRunId,
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    status: commandData.status,
    verdict: commandData.verdict,
    durationMs: commandData.durationMs,
    reasoning: commandData.reasoning,
    error: commandData.error,
  }),
  getLogContext: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    status: commandData.status,
    verdict: commandData.verdict,
  }),
  makeIdempotencyKey: (commandData) =>
    `${commandData.tenantId}:${commandData.batchRunId}:${commandData.scenarioRunId}:itemCompleted`,
};

export class CompleteSuiteRunItemCommand
  implements
    CommandHandler<
      Command<CompleteSuiteRunItemCommandData>,
      SuiteRunProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SUITE_RUN_COMMAND_TYPES.COMPLETE_ITEM,
    completeSuiteRunItemCommandDataSchema,
    "Command to complete a suite run item",
  );

  private readonly handleCommand = createSuiteRunCommandHandler<
    CompleteSuiteRunItemCommandData,
    SuiteRunItemCompletedEvent,
    SuiteRunItemCompletedEventData
  >(config);

  handle(
    command: Command<CompleteSuiteRunItemCommandData>,
  ): CommandHandlerResult<SuiteRunProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: CompleteSuiteRunItemCommandData): string {
    return payload.batchRunId;
  }

  static getSpanAttributes(
    payload: CompleteSuiteRunItemCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.batchRun.id": payload.batchRunId,
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.status": payload.status,
    };
  }

  static makeJobId(payload: CompleteSuiteRunItemCommandData): string {
    return makeJobIdWithSuffix(payload, `${payload.scenarioRunId}:itemCompleted`);
  }
}
