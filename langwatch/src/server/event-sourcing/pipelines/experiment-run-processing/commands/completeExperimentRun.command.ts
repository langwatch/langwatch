import type {
	Command,
	CommandHandler,
	CommandHandlerResult,
} from "../../../";
import { defineCommandSchema } from "../../../";
import type { CompleteExperimentRunCommandData } from "../schemas/commands";
import { completeExperimentRunCommandDataSchema } from "../schemas/commands";
import {
	EXPERIMENT_RUN_COMMAND_TYPES,
	EXPERIMENT_RUN_EVENT_TYPES,
	EXPERIMENT_RUN_EVENT_VERSIONS,
} from "../schemas/constants";
import type {
	ExperimentRunCompletedEvent,
	ExperimentRunCompletedEventData,
	ExperimentRunProcessingEvent,
} from "../schemas/events";
import {
	createExperimentRunCommandHandler,
	type ExperimentRunCommandConfig,
	makeJobIdWithSuffix,
} from "./base.command";

const config: ExperimentRunCommandConfig<
  CompleteExperimentRunCommandData,
  ExperimentRunCompletedEventData
> = {
  eventType: EXPERIMENT_RUN_EVENT_TYPES.COMPLETED,
  eventVersion: EXPERIMENT_RUN_EVENT_VERSIONS.COMPLETED,
  loggerName: "complete-experiment-run",
  handleLogMessage: "Handling complete experiment run command",
  emitLogMessage: "Emitting experiment run completed event",
  mapToEventData: (commandData) => ({
    runId: commandData.runId,
    finishedAt: commandData.finishedAt,
    stoppedAt: commandData.stoppedAt,
  }),
  getLogContext: (commandData) => ({
    wasFinished: !!commandData.finishedAt,
    wasStopped: !!commandData.stoppedAt,
  }),
};

/**
 * Command handler for completing an experiment run.
 * Emits ExperimentRunCompletedEvent when an experiment run finishes.
 */
export class CompleteExperimentRunCommand
  implements
    CommandHandler<
      Command<CompleteExperimentRunCommandData>,
      ExperimentRunProcessingEvent
    >
{
  static readonly schema = defineCommandSchema(
    EXPERIMENT_RUN_COMMAND_TYPES.COMPLETE,
    completeExperimentRunCommandDataSchema,
    "Command to complete an experiment run",
  );

  private readonly handleCommand = createExperimentRunCommandHandler<
    CompleteExperimentRunCommandData,
    ExperimentRunCompletedEvent,
    ExperimentRunCompletedEventData
  >(config);

  handle(
    command: Command<CompleteExperimentRunCommandData>,
  ): CommandHandlerResult<ExperimentRunProcessingEvent> {
    return this.handleCommand(command);
  }

  static getAggregateId(payload: CompleteExperimentRunCommandData): string {
    return payload.runId;
  }

  static getSpanAttributes(
    payload: CompleteExperimentRunCommandData,
  ): Record<string, string | number | boolean> {
    return {
      "payload.run.id": payload.runId,
      "payload.was_finished": !!payload.finishedAt,
      "payload.was_stopped": !!payload.stoppedAt,
    };
  }

  static makeJobId(payload: CompleteExperimentRunCommandData): string {
    return makeJobIdWithSuffix(payload, "complete");
  }
}
