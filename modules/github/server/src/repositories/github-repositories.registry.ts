import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryGithubRepositories } from "./memory/memory.github.repositories.ts";
import { PostgresGithubRepositories } from "./prisma/prisma.github.repositories.ts";

export const githubRepositories = defineRepositories({
  postgres: PostgresGithubRepositories,
  memory: MemoryGithubRepositories,
});
