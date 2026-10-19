import { defineChannels } from "@langwatch/process";

import { HttpAutomationChannels } from "./http/http.automation.channels.ts";
import { MemoryAutomationChannels } from "./memory/memory.automation.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const automationChannels = defineChannels({
  live: HttpAutomationChannels,
  memory: MemoryAutomationChannels,
});
