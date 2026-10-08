import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { TopicApi } from "@langwatch/topic-contract";

import { TopicModule } from "./app/topic.app.ts";
import { topicClusteringEventing } from "./eventing/topic-clustering-processing.pipeline.ts";
import { topicRepositories } from "./repositories/topic-repositories.registry.ts";
import { TopicClusteringRunTask } from "./tasks/topic-clustering-run.task.ts";
import { topicTrpcTransport } from "./transport/topic.trpc.ts";

export const topicProcessModule: PublishedProcessModule<"topic", TopicApi> = defineProcessModule(
  "topic",
)
  .withRepositories(topicRepositories)
  .withApi(TopicModule)
  .withTransports(topicTrpcTransport)
  .withEventing(topicClusteringEventing)
  .withTasks(({ app }) => [TopicClusteringRunTask.create({ topics: app })]);
