import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryTopicRepositories } from "./memory/memory.topic.repositories.ts";
import { PostgresTopicRepositories } from "./prisma/prisma.topic.repositories.ts";

export const topicRepositories = defineRepositories({
  postgres: PostgresTopicRepositories,
  memory: MemoryTopicRepositories,
});
