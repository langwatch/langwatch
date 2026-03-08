import type {
    Command,
    CommandHandler,
    CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { TextMessageEndCommandData } from "../schemas/commands";
import { textMessageEndCommandDataSchema } from "../schemas/commands";
import {
    SIMULATION_RUN_COMMAND_TYPES,
    SIMULATION_EVENT_VERSIONS,
    SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
    SimulationTextMessageEndEvent,
    SimulationTextMessageEndEventData,
    SimulationProcessingEvent,
} from "../schemas/events";
import {
    createSimulationCommandHandler,
    makeJobIdWithSuffix,
    type SimulationCommandConfig,
} from "./base.command";

const config: SimulationCommandConfig<
  TextMessageEndCommandData,
  SimulationTextMessageEndEventData
> = {
  eventType: SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_END,
  eventVersion: SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_END,
  loggerName: "text-message-end",
  handleLogMessage: "Handling text message end command",
  emitLogMessage: "Emitting simulation text message end event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    messageId: commandData.messageId,
    role: commandData.role,
    content: commandData.content,
    message: commandData.message,
    traceId: commandData.traceId,
    messageIndex: commandData.messageIndex,
  }),
  getLogContext: (commandData) => ({
    messageId: commandData.messageId,
    role: commandData.role,
    contentLength: commandData.content.length,
  }),
  makeIdempotencyKey: (commandData) =>
    `${commandData.tenantId}:${commandData.scenarioRunId}:${commandData.messageId}:textEnd`,
};

/**
 * Command handler for recording a text message end (complete message).
 * Emits SimulationTextMessageEndEvent when a message is fully available.
 */
export class TextMessageEndCommand
  implements
    CommandHandler<
      Command<TextMessageEndCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_RUN_COMMAND_TYPES.TEXT_MESSAGE_END,
    textMessageEndCommandDataSchema,
    "Command to record a simulation text message end",
  );

  private readonly handleCommand = createSimulationCommandHandler<
    TextMessageEndCommandData,
    SimulationTextMessageEndEvent,
    SimulationTextMessageEndEventData
  >(config);

  handle(
    command: Command<TextMessageEndCommandData>,
  ): CommandHandlerResult<SimulationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: TextMessageEndCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: TextMessageEndCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.message.id": payload.messageId,
      "payload.message.role": payload.role,
      "payload.message.contentLength": payload.content.length,
    };
  }

  static makeJobId(payload: TextMessageEndCommandData): string {
    return makeJobIdWithSuffix(payload, `text-message-end:${payload.messageId}`);
  }
}
