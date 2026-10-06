import { defineRepositories } from "@langwatch/process";

import { LiveOpsRepositories } from "./live/live.ops.repositories.ts";
import { MemoryOpsRepositories } from "./memory/memory.ops.repositories.ts";

export const opsRepositories = defineRepositories({
  live: LiveOpsRepositories,
  memory: MemoryOpsRepositories,
});
