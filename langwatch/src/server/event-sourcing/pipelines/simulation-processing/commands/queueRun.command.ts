import type {
    Command,
    CommandHandler,
    CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { QueueRunCommandData } from "../schemas/commands";
import { queueRunCommandDataSchema } from "../schemas/commands";
import {
    SIMULATION_RUN_COMMAND_TYPES,
    SIMULATION_EVENT_VERSIONS,
    SIMULATION_RUN_EVENT_TYPES,
} from "../schemas/constants";
import type {
    SimulationProcessingEvent,
    SimulationRunQueuedEvent,
    SimulationRunQueuedEventData,
} from "../schemas/events";
import {
    createSimulationCommandHandler,
    makeJobIdWithSuffix,
    type SimulationCommandConfig,
} from "./base.command";

const config: SimulationCommandConfig<
  QueueRunCommandData,
  SimulationRunQueuedEventData
> = {
  eventType: SIMULATION_RUN_EVENT_TYPES.QUEUED,
  eventVersion: SIMULATION_EVENT_VERSIONS.QUEUED,
  loggerName: "queue-run",
  handleLogMessage: "Handling queue simulation run command",
  emitLogMessage: "Emitting simulation run queued event",
  mapToEventData: (commandData) => ({
    scenarioRunId: commandData.scenarioRunId,
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
    scenarioSetId: commandData.scenarioSetId,
    name: commandData.name,
    description: commandData.description,
    metadata: commandData.metadata,
    target: commandData.target,
  }),
  getLogContext: (commandData) => ({
    scenarioId: commandData.scenarioId,
    batchRunId: commandData.batchRunId,
  }),
  makeIdempotencyKey: (commandData) =>
    `${commandData.tenantId}:${commandData.scenarioRunId}:queueRun`,
};

export class QueueRunCommand
  implements
    CommandHandler<
      Command<QueueRunCommandData>,
      SimulationProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    SIMULATION_RUN_COMMAND_TYPES.QUEUE,
    queueRunCommandDataSchema,
    "Command to queue a simulation run",
  );

  private readonly handleCommand = createSimulationCommandHandler<
    QueueRunCommandData,
    SimulationRunQueuedEvent,
    SimulationRunQueuedEventData
  >(config);

  handle(
    command: Command<QueueRunCommandData>,
  ): CommandHandlerResult<SimulationProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: QueueRunCommandData): string {
    return payload.scenarioRunId;
  }

  static getSpanAttributes(
    payload: QueueRunCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.scenarioRun.id": payload.scenarioRunId,
      "payload.scenario.id": payload.scenarioId,
      "payload.batchRun.id": payload.batchRunId,
    };
  }

  static makeJobId(payload: QueueRunCommandData): string {
    return makeJobIdWithSuffix(payload, "queue-run");
  }
}
