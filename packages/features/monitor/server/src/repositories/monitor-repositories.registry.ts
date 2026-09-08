import { defineRepositories } from "@langwatch/runtime-composition";
import { PostgresMonitorRepositories } from "./prisma/prisma.monitor.repositories.ts";
import { MemoryMonitorRepositories } from "./memory/memory.monitor.repositories.ts";

export const monitorRepositories = defineRepositories({
  postgres: PostgresMonitorRepositories,
  memory: MemoryMonitorRepositories,
});
