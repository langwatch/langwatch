import { defineRepositories } from "@langwatch/process";

import { LiveLogRepositories } from "./live/live.log.repositories.ts";
import { MemoryLogRepositories } from "./memory/memory.log.repositories.ts";

export const logRepositories = defineRepositories({
  live: LiveLogRepositories,
  memory: MemoryLogRepositories,
});
