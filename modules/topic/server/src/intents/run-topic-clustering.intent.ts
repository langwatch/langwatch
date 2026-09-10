import type { TopicClusteringCommands } from "../app/topic.infrastructure.ts";

/** A manual trigger enters Topic through its durable Eventing command. */
export class RequestTopicClusteringTask {
  static create(options: {
    commands: TopicClusteringCommands;
    now?: () => number;
  }): RequestTopicClusteringTask {
    return new RequestTopicClusteringTask(options.commands, options.now ?? Date.now);
  }

  private constructor(
    private readonly commands: TopicClusteringCommands,
    private readonly now: () => number,
  ) {}

  async execute(projectId: string): Promise<void> {
    await this.commands.requestClustering({
      tenantId: projectId,
      occurredAt: this.now(),
      trigger: "manual",
    });
  }
}
