import { defineRepositories } from "@langwatch/kernel";
import { MemoryProjectRepositories } from "./memory/memory.project.repositories.ts";
import { PostgresProjectRepositories } from "./prisma/prisma.project.repositories.ts";

export const projectRepositories = defineRepositories({
  live: PostgresProjectRepositories,
  memory: MemoryProjectRepositories,
});
