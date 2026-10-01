import { defineRepositories } from "@langwatch/kernel";

import { LiveGithubRepositories } from "./live/live.github.repositories.ts";
import { MemoryGithubRepositories } from "./memory/memory.github.repositories.ts";

export const githubRepositories = defineRepositories({
  live: LiveGithubRepositories,
  memory: MemoryGithubRepositories,
});
