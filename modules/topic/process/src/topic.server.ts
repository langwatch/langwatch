import { defineServerModule } from "@langwatch/kernel";

import { TopicApp } from "./app/topic.app.ts";
import type { TopicClusteringMetrics } from "./eventing/topic-clustering.intent.ts";
import { topicRepositories } from "./repositories/topic-repositories.registry.ts";
import { OtelTopicClusteringMetricsService } from "./services/topic-clustering-metrics.service.ts";
import { topicTrpcTransport } from "./transport/topic.trpc.ts";

export const topicServer = defineServerModule("topic")
  .withRepositories(topicRepositories)
  .withApp(TopicApp)
  .withTransports(topicTrpcTransport);

/** The OTel-backed page metrics a worker composition mounts beside the installer. */
export function createTopicClusteringMetrics(): TopicClusteringMetrics {
  return OtelTopicClusteringMetricsService.create();
}
