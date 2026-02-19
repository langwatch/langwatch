import type {
    Command,
    CommandHandler,
    CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { FinishRunCommandData } from "../schemas/commands";
import { finishRunCommandDataSchema } from "../schemas/commands";
import {
    SIMULATION_RUN_COMMAND_TYPES,
    SIMULATION_EVENT_VERSIONS,
    SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
    SimulationProcessingEvent,
    SimulationRunFinishedEvent,
    SimulationRunFinishedEventData,
} from "../schemas/events";
import {
    createSimulationCommandHandler,
    makeJobIdWithSuffix,
    type SimulationCommandConfig,
} from "./base.command";

const config: SimulationCommandConfig<
  FinishRunCommandData,
  SimulationRunFinishedEventData
> = {
  eventType: SIMULATION_RUN_EVENT_TYPES.FINISHED,
  eventVersion: SIMULATION_EVENT_VERSIONS.FINISHED,
  loggerName: "finish-run",
  handleLogMessage: "Handling finish simulation run command",
  emitLogMessage: "Emitting simulation run finished event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    results: commandData.results,
    durationMs: commandData.durationMs,
    status: commandData.status,
  }),
  getLogContext: (commandData) => ({
    hasResults: !!commandData.results,
    durationMs: commandData.durationMs,
  }),
};

/**
 * Command handler for finishing a simulation run.
 * Emits SimulationRunFinishedEvent when a simulation run completes.
 */
export class FinishRunCommand
  implements
    CommandHandler<
      Command<FinishRunCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_RUN_COMMAND_TYPES.FINISH,
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
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.hasResults": !!payload.results,
      "payload.durationMs": payload.durationMs ?? 0,
    };
  }

  static makeJobId(payload: FinishRunCommandData): string {
    return makeJobIdWithSuffix(payload, "finish-run");
  }
}
