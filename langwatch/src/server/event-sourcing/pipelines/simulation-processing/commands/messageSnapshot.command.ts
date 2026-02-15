import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { MessageSnapshotCommandData } from "../schemas/commands";
import { messageSnapshotCommandDataSchema } from "../schemas/commands";
import {
  SIMULATION_COMMAND_TYPES,
  SIMULATION_EVENT_TYPES,
  SIMULATION_EVENT_VERSIONS,
} from "../schemas/constants";
import type {
  SimulationMessageSnapshotEvent,
  SimulationMessageSnapshotEventData,
  SimulationProcessingEvent,
} from "../schemas/events";
import {
  createSimulationCommandHandler,
  type SimulationCommandConfig,
  makeJobIdWithSuffix,
} from "./base.command";

const config: SimulationCommandConfig<
  MessageSnapshotCommandData,
  SimulationMessageSnapshotEventData
> = {
  eventType: SIMULATION_EVENT_TYPES.MESSAGE_SNAPSHOT,
  eventVersion: SIMULATION_EVENT_VERSIONS.MESSAGE_SNAPSHOT,
  loggerName: "message-snapshot",
  handleLogMessage: "Handling message snapshot command",
  emitLogMessage: "Emitting simulation message snapshot event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
    scenarioSetId: commandData.scenarioSetId,
    messages: commandData.messages,
  }),
  getLogContext: (commandData) => ({
    scenarioId: commandData.scenarioId,
    messageCount: commandData.messages.length,
  }),
};

export class MessageSnapshotCommand
  implements
    CommandHandler<
      Command<MessageSnapshotCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_COMMAND_TYPES.MESSAGE_SNAPSHOT,
    messageSnapshotCommandDataSchema,
    "Command to record a message snapshot",
  );

  private readonly handleCommand = createSimulationCommandHandler<
    MessageSnapshotCommandData,
    SimulationMessageSnapshotEvent,
    SimulationMessageSnapshotEventData
  >(config);

  handle(
    command: Command<MessageSnapshotCommandData>,
  ): CommandHandlerResult<SimulationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: MessageSnapshotCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: MessageSnapshotCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenario_run.id": payload.scenarioRunId,
      "payload.scenario.id": payload.scenarioId,
      "payload.message_count": payload.messages.length,
    };
  }

  static makeJobId(payload: MessageSnapshotCommandData): string {
    return makeJobIdWithSuffix(payload, `msg:${payload.occurredAt}`);
  }
}
