import type { TopicClusteringMetrics } from "./eventing/topic-clustering.intent.ts";
import { defineServerModule } from "@langwatch/kernel";
import { TopicApp } from "./app/topic.app.ts";
import { topicRepositories } from "./repositories/topic-repositories.registry.ts";
import {
  PrismaTopicServerInstallerRepository,
  type TopicServerInstallerDependencies,
} from "./repositories/prisma/prisma.topic-server-installer.repository.ts";
import { OtelTopicClusteringMetricsService } from "./services/topic-clustering-metrics.service.ts";
import { topicTrpcTransport } from "./transport/topic.trpc.ts";

export const topicServer = defineServerModule("topic")
  .withRepositories(topicRepositories)
  .withApp(TopicApp)
  .withTransports(topicTrpcTransport);

/** What a worker composition needs from Topic's installer, without the repository class name. */
export type TopicWorkerInstaller = Pick<
  PrismaTopicServerInstallerRepository,
  "commandDispatch" | "install" | "startBootSeeds"
>;

/** Builds Topic's worker-facing installer: its pipeline, runner and boot seeds as one graph. */
export function createTopicWorkerInstaller(
  options: TopicServerInstallerDependencies,
): TopicWorkerInstaller {
  return PrismaTopicServerInstallerRepository.create(options);
}

/** The OTel-backed page metrics a worker composition mounts beside the installer. */
export function createTopicClusteringMetrics(): TopicClusteringMetrics {
  return OtelTopicClusteringMetricsService.create();
}
