import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { FinishRunCommandData } from "../schemas/commands";
import { finishRunCommandDataSchema } from "../schemas/commands";
import {
  SIMULATION_COMMAND_TYPES,
  SIMULATION_EVENT_TYPES,
  SIMULATION_EVENT_VERSIONS,
} from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunFinishedEvent,
  SimulationRunFinishedEventData,
} from "../schemas/events";
import {
  createSimulationCommandHandler,
  type SimulationCommandConfig,
  makeJobIdWithSuffix,
} from "./base.command";

const config: SimulationCommandConfig<
  FinishRunCommandData,
  SimulationRunFinishedEventData
> = {
  eventType: SIMULATION_EVENT_TYPES.RUN_FINISHED,
  eventVersion: SIMULATION_EVENT_VERSIONS.RUN_FINISHED,
  loggerName: "finish-run",
  handleLogMessage: "Handling finish simulation run command",
  emitLogMessage: "Emitting simulation run finished event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
    scenarioSetId: commandData.scenarioSetId,
    status: commandData.status,
    results: commandData.results,
  }),
  getLogContext: (commandData) => ({
    scenarioId: commandData.scenarioId,
    status: commandData.status,
  }),
};

export class FinishRunCommand
  implements
    CommandHandler<
      Command<FinishRunCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_COMMAND_TYPES.FINISH_RUN,
    finishRunCommandDataSchema,
    "Command to finish a simulation run",
  );

  private readonly handleCommand = createSimulationCommandHandler<
    FinishRunCommandData,
    SimulationRunFinishedEvent,
    SimulationRunFinishedEventData
  >(config);

  handle(
    command: Command<FinishRunCommandData>,
  ): CommandHandlerResult<SimulationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: FinishRunCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: FinishRunCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenario_run.id": payload.scenarioRunId,
      "payload.scenario.id": payload.scenarioId,
      "payload.status": payload.status,
    };
  }

  static makeJobId(payload: FinishRunCommandData): string {
    return makeJobIdWithSuffix(payload, "finish");
  }
}
