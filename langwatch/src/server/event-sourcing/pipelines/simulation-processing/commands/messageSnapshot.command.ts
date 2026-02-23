import type {
    Command,
    CommandHandler,
    CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { MessageSnapshotCommandData } from "../schemas/commands";
import { messageSnapshotCommandDataSchema } from "../schemas/commands";
import {
    SIMULATION_RUN_COMMAND_TYPES,
    SIMULATION_EVENT_VERSIONS,
    SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
    SimulationMessageSnapshotEvent,
    SimulationMessageSnapshotEventData,
    SimulationProcessingEvent,
} from "../schemas/events";
import {
    createSimulationCommandHandler,
    makeJobIdWithSuffix,
    type SimulationCommandConfig,
} from "./base.command";

const config: SimulationCommandConfig<
  MessageSnapshotCommandData,
  SimulationMessageSnapshotEventData
> = {
  eventType: SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
  eventVersion: SIMULATION_EVENT_VERSIONS.MESSAGE_SNAPSHOT,
  loggerName: "message-snapshot",
  handleLogMessage: "Handling message snapshot command",
  emitLogMessage: "Emitting simulation message snapshot event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    messages: commandData.messages,
    traceIds: commandData.traceIds,
    status: commandData.status,
  }),
  getLogContext: (commandData) => ({
    messageCount: commandData.messages.length,
    traceIdCount: commandData.traceIds.length,
  }),
};

/**
 * Command handler for recording a message snapshot.
 * Emits SimulationMessageSnapshotEvent when messages are updated.
 */
export class MessageSnapshotCommand
  implements
    CommandHandler<
      Command<MessageSnapshotCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_RUN_COMMAND_TYPES.MESSAGE_SNAPSHOT,
    messageSnapshotCommandDataSchema,
    "Command to record a simulation message snapshot",
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
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.message.count": payload.messages.length,
    };
  }

  static makeJobId(payload: MessageSnapshotCommandData): string {
    return makeJobIdWithSuffix(payload, "message-snapshot");
  }
}
