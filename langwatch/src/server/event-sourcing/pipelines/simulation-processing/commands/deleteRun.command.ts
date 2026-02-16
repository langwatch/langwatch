import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { DeleteRunCommandData } from "../schemas/commands";
import { deleteRunCommandDataSchema } from "../schemas/commands";
import {
  SIMULATION_COMMAND_TYPES,
  SIMULATION_EVENT_TYPES,
  SIMULATION_EVENT_VERSIONS,
} from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunDeletedEvent,
  SimulationRunDeletedEventData,
} from "../schemas/events";
import {
  createSimulationCommandHandler,
  type SimulationCommandConfig,
  makeJobIdWithSuffix,
} from "./base.command";

const config: SimulationCommandConfig<
  DeleteRunCommandData,
  SimulationRunDeletedEventData
> = {
  eventType: SIMULATION_EVENT_TYPES.RUN_DELETED,
  eventVersion: SIMULATION_EVENT_VERSIONS.RUN_DELETED,
  loggerName: "delete-run",
  handleLogMessage: "Handling delete simulation run command",
  emitLogMessage: "Emitting simulation run deleted event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
    scenarioSetId: commandData.scenarioSetId,
  }),
  getLogContext: (commandData) => ({
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
  }),
};

export class DeleteRunCommand
  implements
    CommandHandler<
      Command<DeleteRunCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_COMMAND_TYPES.DELETE_RUN,
    deleteRunCommandDataSchema,
    "Command to soft-delete a simulation run",
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
      "payload.scenario_run.id": payload.scenarioRunId,
      "payload.scenario.id": payload.scenarioId,
    };
  }

  static makeJobId(payload: DeleteRunCommandData): string {
    return makeJobIdWithSuffix(payload, "delete");
  }
}
