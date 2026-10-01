import { defineRepositories } from "@langwatch/process";

import { MemoryAuthzRepositories } from "./memory/memory.authz.repositories.ts";
import { PostgresAuthzRepositories } from "./prisma/prisma.authz.repositories.ts";

export const authzRepositories = defineRepositories({
  live: PostgresAuthzRepositories,
  memory: MemoryAuthzRepositories,
});
