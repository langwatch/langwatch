import type {
  Command,
  CommandHandler,
  CommandHandlerResult,
} from "../../../library";
import { defineCommandSchema } from "../../../library";
import type { CompleteExperimentRunCommandData } from "../schemas/commands";
import { completeExperimentRunCommandDataSchema } from "../schemas/commands";
import {
  EXPERIMENT_RUN_COMPLETED_EVENT_TYPE,
  EXPERIMENT_RUN_COMPLETED_EVENT_VERSION_LATEST,
  COMPLETE_EXPERIMENT_RUN_COMMAND_TYPE,
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
  eventType: EXPERIMENT_RUN_COMPLETED_EVENT_TYPE,
  eventVersion: EXPERIMENT_RUN_COMPLETED_EVENT_VERSION_LATEST,
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
    COMPLETE_EXPERIMENT_RUN_COMMAND_TYPE,
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
