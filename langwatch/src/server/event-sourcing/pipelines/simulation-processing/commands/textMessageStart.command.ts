import type {
    Command,
    CommandHandler,
    CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { TextMessageStartCommandData } from "../schemas/commands";
import { textMessageStartCommandDataSchema } from "../schemas/commands";
import {
    SIMULATION_RUN_COMMAND_TYPES,
    SIMULATION_EVENT_VERSIONS,
    SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
    SimulationTextMessageStartEvent,
    SimulationTextMessageStartEventData,
    SimulationProcessingEvent,
} from "../schemas/events";
import {
    createSimulationCommandHandler,
    makeJobIdWithSuffix,
    type SimulationCommandConfig,
} from "./base.command";

const config: SimulationCommandConfig<
  TextMessageStartCommandData,
  SimulationTextMessageStartEventData
> = {
  eventType: SIMULATION_RUN_EVENT_TYPES.TEXT_MESSAGE_START,
  eventVersion: SIMULATION_EVENT_VERSIONS.TEXT_MESSAGE_START,
  loggerName: "text-message-start",
  handleLogMessage: "Handling text message start command",
  emitLogMessage: "Emitting simulation text message start event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    messageId: commandData.messageId,
    role: commandData.role,
    messageIndex: commandData.messageIndex,
  }),
  getLogContext: (commandData) => ({
    messageId: commandData.messageId,
    role: commandData.role,
  }),
  makeIdempotencyKey: (commandData) =>
    `${commandData.tenantId}:${commandData.scenarioRunId}:${commandData.messageId}:textStart`,
};

/**
 * Command handler for recording a text message start (placeholder).
 * Emits SimulationTextMessageStartEvent when a message begins.
 */
export class TextMessageStartCommand
  implements
    CommandHandler<
      Command<TextMessageStartCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_RUN_COMMAND_TYPES.TEXT_MESSAGE_START,
    textMessageStartCommandDataSchema,
    "Command to record a simulation text message start",
  );

  private readonly handleCommand = createSimulationCommandHandler<
    TextMessageStartCommandData,
    SimulationTextMessageStartEvent,
    SimulationTextMessageStartEventData
  >(config);

  handle(
    command: Command<TextMessageStartCommandData>,
  ): CommandHandlerResult<SimulationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: TextMessageStartCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: TextMessageStartCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.message.id": payload.messageId,
      "payload.message.role": payload.role,
    };
  }

  static makeJobId(payload: TextMessageStartCommandData): string {
    return makeJobIdWithSuffix(payload, `text-message-start:${payload.messageId}`);
  }
}
