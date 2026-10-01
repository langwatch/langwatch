import type { EventingTopicClusteringCommandsService } from "../services/topic-clustering-commands.service.ts";

/** A manual trigger enters Topic through its durable Eventing command. */
export class RequestTopicClusteringTask {
  static create(options: {
    commands: Pick<EventingTopicClusteringCommandsService, "requestClustering">;
    now?: () => number;
  }): RequestTopicClusteringTask {
    return new RequestTopicClusteringTask(options.commands, options.now ?? Date.now);
  }

  private constructor(
    private readonly commands: Pick<EventingTopicClusteringCommandsService, "requestClustering">,
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
