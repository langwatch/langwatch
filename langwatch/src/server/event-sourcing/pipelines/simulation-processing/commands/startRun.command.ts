import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { StartRunCommandData } from "../schemas/commands";
import { startRunCommandDataSchema } from "../schemas/commands";
import {
  SIMULATION_COMMAND_TYPES,
  SIMULATION_EVENT_TYPES,
  SIMULATION_EVENT_VERSIONS,
} from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunStartedEvent,
  SimulationRunStartedEventData,
} from "../schemas/events";
import {
  createSimulationCommandHandler,
  type SimulationCommandConfig,
  makeJobIdWithSuffix,
} from "./base.command";

const config: SimulationCommandConfig<
  StartRunCommandData,
  SimulationRunStartedEventData
> = {
  eventType: SIMULATION_EVENT_TYPES.RUN_STARTED,
  eventVersion: SIMULATION_EVENT_VERSIONS.RUN_STARTED,
  loggerName: "start-run",
  handleLogMessage: "Handling start simulation run command",
  emitLogMessage: "Emitting simulation run started event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
    scenarioSetId: commandData.scenarioSetId,
    metadata: commandData.metadata,
  }),
  getLogContext: (commandData) => ({
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
  }),
};

export class StartRunCommand
  implements
    CommandHandler<
      Command<StartRunCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_COMMAND_TYPES.START_RUN,
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
      "payload.scenario_run.id": payload.scenarioRunId,
      "payload.scenario.id": payload.scenarioId,
      "payload.batch_run.id": payload.batchRunId,
    };
  }

  static makeJobId(payload: StartRunCommandData): string {
    return makeJobIdWithSuffix(payload, "start");
  }
}
