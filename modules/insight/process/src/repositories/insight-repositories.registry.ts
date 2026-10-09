import { defineRepositories } from "@langwatch/process";

import { MemoryInsightRepositories } from "./memory/memory.insight.repositories.ts";
import { PostgresInsightRepositories } from "./prisma/prisma.insight.repositories.ts";

export const insightRepositories = defineRepositories({
  live: PostgresInsightRepositories,
  memory: MemoryInsightRepositories,
});
