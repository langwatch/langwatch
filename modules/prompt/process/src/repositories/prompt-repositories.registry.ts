import { defineRepositories } from "@langwatch/process";

import { MemoryPromptRepositories } from "./memory/memory.prompt.repositories.ts";
import { PostgresPromptRepositories } from "./prisma/prisma.prompt.repositories.ts";

export const promptRepositories = defineRepositories({
  live: PostgresPromptRepositories,
  memory: MemoryPromptRepositories,
});
