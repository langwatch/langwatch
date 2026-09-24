import { defineServerModule } from "@langwatch/kernel";

import { TopicApp } from "./app/topic.app.ts";
import { topicClusteringEventing } from "./eventing/topic-clustering-processing.pipeline.ts";
import type { TopicClusteringMetrics } from "./eventing/topic-clustering.intent.ts";
import { topicRepositories } from "./repositories/topic-repositories.registry.ts";
import { OtelTopicClusteringMetricsService } from "./services/topic-clustering-metrics.service.ts";
import { TopicClusteringRunTask } from "./tasks/topic-clustering-run.task.ts";
import { topicTrpcTransport } from "./transport/topic.trpc.ts";

export const topicServer = defineServerModule("topic")
  .withRepositories(topicRepositories)
  .withApp(TopicApp)
  .withTransports(topicTrpcTransport)
  .withEventing(topicClusteringEventing)
  .withTasks(({ app }) => {
    if (!(app instanceof TopicApp)) throw new Error("topic's tasks need the TopicApp it installed");
    return [TopicClusteringRunTask.create({ topics: app })];
  });

/** The OTel-backed page metrics a worker composition mounts beside the installer. */
export function createTopicClusteringMetrics(): TopicClusteringMetrics {
  return OtelTopicClusteringMetricsService.create();
}
