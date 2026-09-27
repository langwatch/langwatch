import { defineRepositories } from "@langwatch/kernel";

import { MemoryIdentityRepositories } from "./memory/memory.identity.repositories.ts";
import {
  PostgresIdentityRepositories,
  identityMigrationRepositoriesOverPrisma,
  identityPipelineRepositoriesOverPrisma,
} from "./prisma/prisma.identity.repositories.ts";

export const identityRepositories = defineRepositories({
  live: PostgresIdentityRepositories,
  memory: MemoryIdentityRepositories,
});

/** The live rows a one-shot migration pass reads, for a process that holds no encryption. */
export const identityMigrationRepositories = identityMigrationRepositoriesOverPrisma;

/** The identity pipeline's live rows, for a process that sends commands and holds no encryption. */
export const identityPipelineRepositories = identityPipelineRepositoriesOverPrisma;
