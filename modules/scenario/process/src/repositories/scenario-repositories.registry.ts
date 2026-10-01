import { defineRepositories } from "@langwatch/kernel";

import { LiveScenarioRepositories } from "./live/live.scenario.repositories.ts";
import { MemoryScenarioRepositories } from "./memory/memory.scenario.repositories.ts";

/** Which backing the Scenario aggregate is read through, chosen once at boot. */
export const scenarioRepositories = defineRepositories({
  live: LiveScenarioRepositories,
  memory: MemoryScenarioRepositories,
});
