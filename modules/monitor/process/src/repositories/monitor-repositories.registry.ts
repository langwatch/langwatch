import { defineRepositories } from "@langwatch/kernel";

import { MemoryMonitorRepositories } from "./memory/memory.monitor.repositories.ts";
import { PostgresMonitorRepositories } from "./prisma/prisma.monitor.repositories.ts";

export const monitorRepositories = defineRepositories({
  live: PostgresMonitorRepositories,
  memory: MemoryMonitorRepositories,
});
