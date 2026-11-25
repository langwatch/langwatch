import { defineRepositories } from "@langwatch/process";

import { LiveAuthzRepositories } from "./live/live.authz.repositories.ts";
import { MemoryAuthzRepositories } from "./memory/memory.authz.repositories.ts";

export const authzRepositories = defineRepositories({
  live: LiveAuthzRepositories,
  memory: MemoryAuthzRepositories,
});
