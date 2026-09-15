import { defineRepositories } from "@langwatch/runtime-composition";
import { MemoryScenarioRepositories } from "./memory/memory.scenario.repositories.ts";
import { PostgresScenarioRepositories } from "./prisma/prisma.scenario.repositories.ts";

/** Which backing the Scenario aggregate is read through, chosen once at boot. */
export const scenarioRepositories = defineRepositories({
  live: PostgresScenarioRepositories,
  memory: MemoryScenarioRepositories,
});
