import type {
  TopicClusteringTrigger,
  TopicModelEntry,
  TopicModelRecordMode,
  TopicModelRecordSource,
} from "@langwatch/topic-contract";
import type { TopicClusteringOutcomeCommands } from "../intents/topic-clustering.intent";
import { TopicClusteringCommandsPort } from "../ports/topic-clustering-commands.port";

type CommandSender<Input> = {
  send(input: Input): Promise<unknown>;
};

type RecordTopicsInput = {
  tenantId: string;
  occurredAt: number;
  mode: TopicModelRecordMode;
  source: TopicModelRecordSource;
  dedupeKey: string;
  topics: TopicModelEntry[];
};

type RequestClusteringInput = {
  tenantId: string;
  occurredAt: number;
  trigger: TopicClusteringTrigger;
  requestedByUserId?: string;
};

type RunStartedInput = {
  tenantId: string;
  occurredAt: number;
  runId: string;
  page: number;
};

type RunCompletedInput = RunStartedInput & {
  mode: "batch" | "incremental";
  tracesProcessed: number;
  topicsCount: number;
  subtopicsCount: number;
  skippedReason?: "recently_clustered" | "not_enough_traces" | "not_configured";
  nextSearchAfter?: [number, string];
};

type RunFailedInput = RunStartedInput & {
  error: string;
  errorCode: string;
  isUserActionable: boolean;
};

/**
 * Binds Topic's own command transport after registration. It stores command
 * objects, rather than application callbacks, so all delayed work continues
 * through the owning Eventing pipeline.
 */
export class EventingTopicClusteringCommandsAdapter extends TopicClusteringCommandsPort {
  private recordTopicsCommand: CommandSender<RecordTopicsInput> | null = null;
  private requestClusteringCommand: CommandSender<RequestClusteringInput> | null = null;

  connect(commands: {
    recordTopics: CommandSender<RecordTopicsInput>;
    requestClustering: CommandSender<RequestClusteringInput>;
  }): void {
    this.recordTopicsCommand = commands.recordTopics;
    this.requestClusteringCommand = commands.requestClustering;
  }

  async recordTopics(input: RecordTopicsInput): Promise<void> {
    await this.getRecordTopicsCommand().send(input);
  }

  async requestClustering(input: RequestClusteringInput): Promise<void> {
    await this.getRequestClusteringCommand().send(input);
  }

  private getRecordTopicsCommand(): CommandSender<RecordTopicsInput> {
    if (!this.recordTopicsCommand) {
      throw new Error("Topic clustering commands used before pipeline registration");
    }
    return this.recordTopicsCommand;
  }

  private getRequestClusteringCommand(): CommandSender<RequestClusteringInput> {
    if (!this.requestClusteringCommand) {
      throw new Error("Topic clustering commands used before pipeline registration");
    }
    return this.requestClusteringCommand;
  }
}

/** Late-bound outcome transport for the pipeline's own retry-safe intent executor. */
export class EventingTopicClusteringOutcomeCommandsAdapter implements TopicClusteringOutcomeCommands {
  private runStartedCommand: CommandSender<RunStartedInput> | null = null;
  private runCompletedCommand: CommandSender<RunCompletedInput> | null = null;
  private runFailedCommand: CommandSender<RunFailedInput> | null = null;

  connect(commands: {
    recordClusteringRunStarted: CommandSender<RunStartedInput>;
    recordClusteringRunCompleted: CommandSender<RunCompletedInput>;
    recordClusteringRunFailed: CommandSender<RunFailedInput>;
  }): void {
    this.runStartedCommand = commands.recordClusteringRunStarted;
    this.runCompletedCommand = commands.recordClusteringRunCompleted;
    this.runFailedCommand = commands.recordClusteringRunFailed;
  }

  async recordClusteringRunStarted(input: RunStartedInput): Promise<void> {
    await this.getRunStartedCommand().send(input);
  }

  async recordClusteringRunCompleted(input: RunCompletedInput): Promise<void> {
    await this.getRunCompletedCommand().send(input);
  }

  async recordClusteringRunFailed(input: RunFailedInput): Promise<void> {
    await this.getRunFailedCommand().send(input);
  }

  private getRunStartedCommand(): CommandSender<RunStartedInput> {
    if (!this.runStartedCommand)
      throw new Error("Topic clustering outcome command is not connected");
    return this.runStartedCommand;
  }

  private getRunCompletedCommand(): CommandSender<RunCompletedInput> {
    if (!this.runCompletedCommand)
      throw new Error("Topic clustering outcome command is not connected");
    return this.runCompletedCommand;
  }

  private getRunFailedCommand(): CommandSender<RunFailedInput> {
    if (!this.runFailedCommand)
      throw new Error("Topic clustering outcome command is not connected");
    return this.runFailedCommand;
  }
}
