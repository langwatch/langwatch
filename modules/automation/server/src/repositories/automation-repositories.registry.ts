import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryAutomationRepositories } from "./memory/memory.automation.repositories.ts";
import { PostgresAutomationRepositories } from "./prisma/prisma.automation.repositories.ts";

export const automationRepositories = defineRepositories({
  live: PostgresAutomationRepositories,
  memory: MemoryAutomationRepositories,
});
