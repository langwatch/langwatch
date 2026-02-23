import type {
	Command,
	CommandHandler,
	CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { StartExperimentRunCommandData } from "../schemas/commands";
import { startExperimentRunCommandDataSchema } from "../schemas/commands";
import {
	EXPERIMENT_RUN_COMMAND_TYPES,
	EXPERIMENT_RUN_EVENT_TYPES,
	EXPERIMENT_RUN_EVENT_VERSIONS,
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
  eventType: EXPERIMENT_RUN_EVENT_TYPES.STARTED,
  eventVersion: EXPERIMENT_RUN_EVENT_VERSIONS.STARTED,
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
    EXPERIMENT_RUN_COMMAND_TYPES.START,
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
