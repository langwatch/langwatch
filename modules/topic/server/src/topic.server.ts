import { defineModule } from "@langwatch/runtime-composition";
import { TopicApp } from "./app/topic.app.ts";
import { topicRepositories } from "./repositories/topic-repositories.registry.ts";
import { topicTrpcTransport } from "./transport/topic.trpc.ts";

export const topicServer = defineModule("topic")
  .withRepositories(topicRepositories)
  .withApp(TopicApp)
  .withTransports(topicTrpcTransport)
  .build();
