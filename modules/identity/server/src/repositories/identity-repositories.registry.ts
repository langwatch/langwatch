import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryIdentityRepositories } from "./memory/memory.identity.repositories.ts";
import { PostgresIdentityRepositories } from "./prisma/prisma.identity.repositories.ts";

export const identityRepositories = defineRepositories({
  live: PostgresIdentityRepositories,
  memory: MemoryIdentityRepositories,
});
