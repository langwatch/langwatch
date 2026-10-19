import { defineRepositories } from "@langwatch/process";

import { LiveHostedMcpRepositories } from "./live/live.hosted-mcp.repositories.ts";
import { MemoryHostedMcpRepositories } from "./memory/memory.hosted-mcp.repositories.ts";

export const hostedMcpRepositories = defineRepositories({
  live: LiveHostedMcpRepositories,
  memory: MemoryHostedMcpRepositories,
});
