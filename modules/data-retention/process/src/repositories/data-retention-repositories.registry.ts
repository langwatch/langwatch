import { defineRepositories } from "@langwatch/process";

import { LiveDataRetentionRepositories } from "./live/live.data-retention.repositories.ts";
import { MemoryDataRetentionRepositories } from "./memory/memory.data-retention.repositories.ts";

export const dataRetentionRepositories = defineRepositories({
  live: LiveDataRetentionRepositories,
  memory: MemoryDataRetentionRepositories,
});
