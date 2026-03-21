import type {
    Command,
    CommandHandler,
    CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { UpdateRunMetricsCommandData } from "../schemas/commands";
import { updateRunMetricsCommandDataSchema } from "../schemas/commands";
import {
    SIMULATION_RUN_COMMAND_TYPES,
    SIMULATION_EVENT_VERSIONS,
    SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
    SimulationProcessingEvent,
    SimulationRunMetricsUpdatedEvent,
    SimulationRunMetricsUpdatedEventData,
} from "../schemas/events";
import {
    createSimulationCommandHandler,
    makeJobIdWithSuffix,
    type SimulationCommandConfig,
} from "./base.command";

const config: SimulationCommandConfig<
  UpdateRunMetricsCommandData,
  SimulationRunMetricsUpdatedEventData
> = {
  eventType: SIMULATION_RUN_EVENT_TYPES.METRICS_UPDATED,
  eventVersion: SIMULATION_EVENT_VERSIONS.METRICS_UPDATED,
  loggerName: "update-run-metrics",
  handleLogMessage: "Handling update run metrics command",
  emitLogMessage: "Emitting simulation run metrics updated event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    totalCost: commandData.totalCost,
    roleCosts: commandData.roleCosts,
    roleLatencies: commandData.roleLatencies,
  }),
  getLogContext: (commandData) => ({
    totalCost: commandData.totalCost,
    roleCount: Object.keys(commandData.roleCosts).length,
  }),
  makeIdempotencyKey: (commandData) =>
    `${commandData.tenantId}:${commandData.scenarioRunId}:updateRunMetrics`,
};

/**
 * Command handler for updating simulation run metrics from trace data.
 * Emits SimulationRunMetricsUpdatedEvent with per-role cost and latency.
 */
export class UpdateRunMetricsCommand
  implements
    CommandHandler<
      Command<UpdateRunMetricsCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_RUN_COMMAND_TYPES.UPDATE_METRICS,
    updateRunMetricsCommandDataSchema,
    "Command to update simulation run cost/latency metrics from trace data",
  );

  private readonly handleCommand = createSimulationCommandHandler<
    UpdateRunMetricsCommandData,
    SimulationRunMetricsUpdatedEvent,
    SimulationRunMetricsUpdatedEventData
  >(config);

  handle(
    command: Command<UpdateRunMetricsCommandData>,
  ): CommandHandlerResult<SimulationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: UpdateRunMetricsCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: UpdateRunMetricsCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.totalCost": payload.totalCost ?? 0,
      "payload.roleCount": Object.keys(payload.roleCosts).length,
    };
  }

  static makeJobId(payload: UpdateRunMetricsCommandData): string {
    return makeJobIdWithSuffix(payload, "update-run-metrics");
  }
}
