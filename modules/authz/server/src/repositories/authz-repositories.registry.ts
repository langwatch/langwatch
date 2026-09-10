import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryAuthzRepositories } from "./memory/memory.authz.repositories.ts";
import { PostgresAuthzRepositories } from "./prisma/prisma.authz.repositories.ts";

export const authzRepositories = defineRepositories({
  postgres: PostgresAuthzRepositories,
  memory: MemoryAuthzRepositories,
});
