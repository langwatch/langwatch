import { defineRepositories } from "@langwatch/process";

import { ClickHouseUsageRepositories } from "./clickhouse/clickhouse.usage.repositories.ts";
import { MemoryUsageRepositories } from "./memory/memory.usage.repositories.ts";

export const usageRepositories = defineRepositories({
  live: ClickHouseUsageRepositories,
  memory: MemoryUsageRepositories,
});
