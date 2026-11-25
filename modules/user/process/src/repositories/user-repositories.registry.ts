import { defineRepositories } from "@langwatch/process";

import { LiveUserRepositories } from "./live/live.user.repositories.ts";
import { MemoryUserRepositories } from "./memory/memory.user.repositories.ts";

export const userRepositories = defineRepositories({
  live: LiveUserRepositories,
  memory: MemoryUserRepositories,
});
