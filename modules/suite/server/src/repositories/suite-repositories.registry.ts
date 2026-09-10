import { defineRepositories } from "@langwatch/runtime-composition";
import { MemorySuiteRepositories } from "./memory/memory.suite.repositories.ts";
import { PostgresSuiteRepositories } from "./prisma/prisma.suite.repositories.ts";

export const suiteRepositories = defineRepositories({
  live: PostgresSuiteRepositories,
  memory: MemorySuiteRepositories,
});
