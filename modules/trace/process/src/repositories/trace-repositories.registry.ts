import { defineRepositories } from "@langwatch/kernel";

import { LiveTraceRepositories } from "./live/live.trace.repositories.ts";
import { MemoryTraceRepositories } from "./memory/memory.trace.repositories.ts";

export const traceRepositories = defineRepositories({
  live: LiveTraceRepositories,
  memory: MemoryTraceRepositories,
});
