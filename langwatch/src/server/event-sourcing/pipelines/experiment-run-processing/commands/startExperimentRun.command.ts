import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { StartExperimentRunCommandData } from "../schemas/commands";
import { startExperimentRunCommandDataSchema } from "../schemas/commands";
import {
  EXPERIMENT_RUN_STARTED_EVENT_TYPE,
  EXPERIMENT_RUN_STARTED_EVENT_VERSION_LATEST,
  START_EXPERIMENT_RUN_COMMAND_TYPE,
} from "../schemas/constants";
import type {
  ExperimentRunProcessingEvent,
  ExperimentRunStartedEvent,
  ExperimentRunStartedEventData,
} from "../schemas/events";
import {
  createExperimentRunCommandHandler,
  type ExperimentRunCommandConfig,
  makeJobIdWithSuffix,
} from "./base.command";

const config: ExperimentRunCommandConfig<
  StartExperimentRunCommandData,
  ExperimentRunStartedEventData
> = {
  eventType: EXPERIMENT_RUN_STARTED_EVENT_TYPE,
  eventVersion: EXPERIMENT_RUN_STARTED_EVENT_VERSION_LATEST,
  loggerName: "start-experiment-run",
  handleLogMessage: "Handling start experiment run command",
  emitLogMessage: "Emitting experiment run started event",
  mapToEventData: (commandData) => ({
    runId: commandData.runId,
    experimentId: commandData.experimentId,
    workflowVersionId: commandData.workflowVersionId,
    total: commandData.total,
    targets: commandData.targets,
  }),
  getLogContext: (commandData) => ({
    experimentId: commandData.experimentId,
    total: commandData.total,
  }),
};

/**
 * Command handler for starting an experiment run.
 * Emits ExperimentRunStartedEvent when an experiment run begins.
 */
export class StartExperimentRunCommand
  implements
    CommandHandler<
      Command<StartExperimentRunCommandData>,
      ExperimentRunProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    START_EXPERIMENT_RUN_COMMAND_TYPE,
    startExperimentRunCommandDataSchema,
    "Command to start an experiment run",
  );

  private readonly handleCommand = createExperimentRunCommandHandler<
    StartExperimentRunCommandData,
    ExperimentRunStartedEvent,
    ExperimentRunStartedEventData
  >(config);

  handle(
    command: Command<StartExperimentRunCommandData>,
  ): CommandHandlerResult<ExperimentRunProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: StartExperimentRunCommandData): string {
    return payload.runId;
  }

  static getSpanAttributes(
    payload: StartExperimentRunCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.run.id": payload.runId,
      "payload.experiment.id": payload.experimentId,
      "payload.total": payload.total,
    };
  }

  static makeJobId(payload: StartExperimentRunCommandData): string {
    return makeJobIdWithSuffix(payload, "start");
  }
}
