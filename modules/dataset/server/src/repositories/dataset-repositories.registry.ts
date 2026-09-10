import { defineRepositories } from "@langwatch/runtime-composition";

import { MemoryDatasetRepositories } from "./memory/memory.dataset.repositories.ts";
import { PostgresDatasetRepositories } from "./prisma/prisma.dataset.repositories.ts";

export const datasetRepositories = defineRepositories({
  live: PostgresDatasetRepositories,
  memory: MemoryDatasetRepositories,
});
