import { defineRepositories } from "@langwatch/kernel";

import { MemoryUserRepositories } from "./memory/memory.user.repositories.ts";
import { PostgresUserRepositories } from "./prisma/prisma.user.repositories.ts";

export const userRepositories = defineRepositories({
  live: PostgresUserRepositories,
  memory: MemoryUserRepositories,
});
