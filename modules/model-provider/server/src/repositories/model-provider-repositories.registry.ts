import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryModelProviderRepositories } from "./memory/memory.model-provider.repositories.ts";
import { PostgresModelProviderRepositories } from "./prisma/prisma.model-provider.repositories.ts";

/**
 * Postgres asks the process for the deployment's credential codec as well as
 * its Prisma client: a stored credential is written and read through the
 * deployment's own cipher, and the row format is shared between processes.
 */
export const modelProviderRepositories = defineRepositories({
  postgres: PostgresModelProviderRepositories,
  memory: MemoryModelProviderRepositories,
});
