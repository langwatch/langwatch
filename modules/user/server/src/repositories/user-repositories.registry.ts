import { defineRepositories } from "@langwatch/runtime-composition";
import { PostgresUserRepositories } from "./prisma/prisma.user.repositories.ts";
import { MemoryUserRepositories } from "./memory/memory.user.repositories.ts";

export const userRepositories = defineRepositories({
  live: PostgresUserRepositories,
  memory: MemoryUserRepositories,
});
