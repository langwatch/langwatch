import { defineRepositories } from "@langwatch/process";

import { LiveMetricRepositories } from "./live/live.metric.repositories.ts";
import { MemoryMetricRepositories } from "./memory/memory.metric.repositories.ts";

export const metricRepositories = defineRepositories({
  live: LiveMetricRepositories,
  memory: MemoryMetricRepositories,
});
