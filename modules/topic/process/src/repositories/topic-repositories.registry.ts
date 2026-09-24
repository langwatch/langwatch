import { defineRepositories } from "@langwatch/kernel";

import { LiveTopicRepositories } from "./live/live.topic.repositories.ts";
import { MemoryTopicRepositories } from "./memory/memory.topic.repositories.ts";

export const topicRepositories = defineRepositories({
  live: LiveTopicRepositories,
  memory: MemoryTopicRepositories,
});
