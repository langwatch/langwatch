import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryTraceRepositories } from "./memory/memory.trace.repositories.ts";
import { PostgresTraceRepositories } from "./prisma/prisma.trace.repositories.ts";

export const traceRepositories = defineRepositories({
  live: PostgresTraceRepositories,
  memory: MemoryTraceRepositories,
});
