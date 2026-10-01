import { defineRepositories } from "@langwatch/kernel";

import { MemoryDatasetRepositories } from "./memory/memory.dataset.repositories.ts";
import { PostgresDatasetRepositories } from "./prisma/prisma.dataset.repositories.ts";

export const datasetRepositories = defineRepositories({
  live: PostgresDatasetRepositories,
  memory: MemoryDatasetRepositories,
});
