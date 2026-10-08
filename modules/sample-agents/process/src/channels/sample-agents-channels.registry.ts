import { defineChannels } from "@langwatch/process";

import { HttpSampleAgentsChannels } from "./http/http.sample-agents.channels.ts";
import { MemorySampleAgentsChannels } from "./memory/memory.sample-agents.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const sampleAgentsChannels = defineChannels({
  live: HttpSampleAgentsChannels,
  memory: MemorySampleAgentsChannels,
});
