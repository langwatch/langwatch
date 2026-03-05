import type {
    Command,
    CommandHandler,
    CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { StartRunCommandData } from "../schemas/commands";
import { startRunCommandDataSchema } from "../schemas/commands";
import {
    SIMULATION_RUN_COMMAND_TYPES,
    SIMULATION_EVENT_VERSIONS,
    SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
    SimulationProcessingEvent,
    SimulationRunStartedEvent,
    SimulationRunStartedEventData,
} from "../schemas/events";
import {
    createSimulationCommandHandler,
    makeJobIdWithSuffix,
    type SimulationCommandConfig,
} from "./base.command";

const config: SimulationCommandConfig<
  StartRunCommandData,
  SimulationRunStartedEventData
> = {
  eventType: SIMULATION_RUN_EVENT_TYPES.STARTED,
  eventVersion: SIMULATION_EVENT_VERSIONS.STARTED,
  loggerName: "start-run",
  handleLogMessage: "Handling start simulation run command",
  emitLogMessage: "Emitting simulation run started event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
    scenarioSetId: commandData.scenarioSetId,
    name: commandData.name,
    description: commandData.description,
  }),
  getLogContext: (commandData) => ({
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
  }),
};

/**
 * Command handler for starting a simulation run.
 * Emits SimulationRunStartedEvent when a simulation run begins.
 */
export class StartRunCommand
  implements
    CommandHandler<
      Command<StartRunCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_RUN_COMMAND_TYPES.START,
    startRunCommandDataSchema,
    "Command to start a simulation run",
  );

  private readonly handleCommand = createSimulationCommandHandler<
    StartRunCommandData,
    SimulationRunStartedEvent,
    SimulationRunStartedEventData
  >(config);

  handle(
    command: Command<StartRunCommandData>,
  ): CommandHandlerResult<SimulationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: StartRunCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: StartRunCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.scenario.id": payload.scenarioId,
      "payload.batchRun.id": payload.batchRunId,
    };
  }

  static makeJobId(payload: StartRunCommandData): string {
    return makeJobIdWithSuffix(payload, "start-run");
  }
}
