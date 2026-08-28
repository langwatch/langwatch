import { RequestTopicClusteringTask } from "@langwatch/topic-server";
import { initializeDefaultApp } from "~/server/app-layer/presets";

/** Legacy task-registry transport over Topic's durable Eventing command. */
export default async function execute(projectId: string): Promise<void> {
  const app = initializeDefaultApp();
  await RequestTopicClusteringTask.create({ commands: app.topicClustering }).execute(projectId);
}
