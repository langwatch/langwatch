import { defineRepositories } from "@langwatch/kernel";

import { MemoryGithubRepositories } from "./memory/memory.github.repositories.ts";
import { PostgresGithubRepositories } from "./prisma/prisma.github.repositories.ts";

export const githubRepositories = defineRepositories({
  live: PostgresGithubRepositories,
  memory: MemoryGithubRepositories,
});
