import { defineProcessModule } from "@langwatch/process";

import { TopicModule } from "./app/topic.app.ts";
import { topicClusteringEventing } from "./eventing/topic-clustering-processing.pipeline.ts";
import type { TopicClusteringMetrics } from "./eventing/topic-clustering.intent.ts";
import { topicRepositories } from "./repositories/topic-repositories.registry.ts";
import { OtelTopicClusteringMetricsService } from "./services/topic-clustering-metrics.service.ts";
import { TopicClusteringRunTask } from "./tasks/topic-clustering-run.task.ts";
import { topicTrpcTransport } from "./transport/topic.trpc.ts";

export const topicProcessModule = defineProcessModule("topic")
  .withRepositories(topicRepositories)
  .withApi(TopicModule)
  .withTransports(topicTrpcTransport)
  .withEventing(topicClusteringEventing)
  .withTasks(({ app }) => [TopicClusteringRunTask.create({ topics: app })]);

/** The OTel-backed page metrics a worker composition mounts beside the installer. */
export function createTopicClusteringMetrics(): TopicClusteringMetrics {
  return OtelTopicClusteringMetricsService.create();
}
