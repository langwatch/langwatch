import { Task } from "@langwatch/task";

import type { TopicApp } from "../app/topic.app.ts";

/**
 * Manual, one-shot clustering run for a single project — the operator's escape hatch for a
 * project that needs a run outside its own cadence gate, or a re-run after a langevals/model
 * incident.
 */
export class TopicClusteringRunTask extends Task {
  readonly name = "topic-clustering-run";
  readonly description = "Runs a manual topic-clustering walk for one project.";

  private constructor(private readonly topics: Pick<TopicApp, "runClusteringForProject">) {
    super();
  }

  static create({
    topics,
  }: {
    topics: Pick<TopicApp, "runClusteringForProject">;
  }): TopicClusteringRunTask {
    return new TopicClusteringRunTask(topics);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const projectId = args[0];
    if (!projectId) {
      throw new Error("topic-clustering-run requires a projectId as its first argument");
    }
    await this.topics.runClusteringForProject({ projectId });
  }
}
