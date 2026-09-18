import { defineRepositories } from "@langwatch/kernel";

import { MemoryDataRetentionRepositories } from "./memory/memory.data-retention.repositories.ts";
import { PostgresDataRetentionRepositories } from "./prisma/prisma.data-retention.repositories.ts";

export const dataRetentionRepositories = defineRepositories({
  live: PostgresDataRetentionRepositories,
  memory: MemoryDataRetentionRepositories,
});
