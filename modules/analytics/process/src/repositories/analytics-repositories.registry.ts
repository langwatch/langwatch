import { defineRepositories } from "@langwatch/process";

import { LiveAnalyticsRepositories } from "./live/live.analytics.repositories.ts";
import { MemoryAnalyticsRepositories } from "./memory/memory.analytics.repositories.ts";

export const analyticsRepositories = defineRepositories({
  live: LiveAnalyticsRepositories,
  memory: MemoryAnalyticsRepositories,
});
