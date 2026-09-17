import { defineRepositories } from "@langwatch/kernel";
import { PostgresMonitorRepositories } from "./prisma/prisma.monitor.repositories.ts";
import { MemoryMonitorRepositories } from "./memory/memory.monitor.repositories.ts";

export const monitorRepositories = defineRepositories({
  live: PostgresMonitorRepositories,
  memory: MemoryMonitorRepositories,
});
