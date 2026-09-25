import { defineRepositories } from "@langwatch/kernel";

import { MemoryIdentityRepositories } from "./memory/memory.identity.repositories.ts";
import {
  PostgresIdentityRepositories,
  identityMigrationRepositoriesOverPrisma,
} from "./prisma/prisma.identity.repositories.ts";

export const identityRepositories = defineRepositories({
  live: PostgresIdentityRepositories,
  memory: MemoryIdentityRepositories,
});

/** The live rows a one-shot migration pass reads, for a process that holds no encryption. */
export const identityMigrationRepositories = identityMigrationRepositoriesOverPrisma;
