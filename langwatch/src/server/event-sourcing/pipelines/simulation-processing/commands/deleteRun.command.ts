import type {
    Command,
    CommandHandler,
    CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { DeleteRunCommandData } from "../schemas/commands";
import { deleteRunCommandDataSchema } from "../schemas/commands";
import {
    SIMULATION_RUN_COMMAND_TYPES,
    SIMULATION_EVENT_VERSIONS,
    SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
    SimulationProcessingEvent,
    SimulationRunDeletedEvent,
    SimulationRunDeletedEventData,
} from "../schemas/events";
import {
    createSimulationCommandHandler,
    makeJobIdWithSuffix,
    type SimulationCommandConfig,
} from "./base.command";

const config: SimulationCommandConfig<
  DeleteRunCommandData,
  SimulationRunDeletedEventData
> = {
  eventType: SIMULATION_RUN_EVENT_TYPES.DELETED,
  eventVersion: SIMULATION_EVENT_VERSIONS.DELETED,
  loggerName: "delete-run",
  handleLogMessage: "Handling delete simulation run command",
  emitLogMessage: "Emitting simulation run deleted event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
  }),
  getLogContext: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
  }),
};

/**
 * Command handler for deleting a simulation run.
 * Emits SimulationRunDeletedEvent for soft-delete.
 */
export class DeleteRunCommand
  implements
    CommandHandler<
      Command<DeleteRunCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_RUN_COMMAND_TYPES.DELETE,
    deleteRunCommandDataSchema,
    "Command to delete a simulation run",
  );

  private readonly handleCommand = createSimulationCommandHandler<
    DeleteRunCommandData,
    SimulationRunDeletedEvent,
    SimulationRunDeletedEventData
  >(config);

  handle(
    command: Command<DeleteRunCommandData>,
  ): CommandHandlerResult<SimulationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: DeleteRunCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: DeleteRunCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
    };
  }

  static makeJobId(payload: DeleteRunCommandData): string {
    return makeJobIdWithSuffix(payload, "delete-run");
  }
}
