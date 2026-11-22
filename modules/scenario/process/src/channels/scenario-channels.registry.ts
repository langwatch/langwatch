import { defineChannels } from "@langwatch/process";

import { HttpScenarioChannels } from "./http/http.scenario.channels.ts";
import { MemoryScenarioChannels } from "./memory/memory.scenario.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const scenarioChannels = defineChannels({
  live: HttpScenarioChannels,
  memory: MemoryScenarioChannels,
});
