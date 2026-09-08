import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryRoleRepositories } from "./memory/memory.role.repositories.ts";
import { PostgresRoleRepositories } from "./prisma/prisma.role.repositories.ts";

export const roleRepositories = defineRepositories({
  postgres: PostgresRoleRepositories,
  memory: MemoryRoleRepositories,
});
