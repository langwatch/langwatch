import { defineChannels } from "@langwatch/process";

import { HttpPlatformHealthChannels } from "./http/http.platform-health.channels.ts";
import { MemoryPlatformHealthChannels } from "./memory/memory.platform-health.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const platformHealthChannels = defineChannels({
  live: HttpPlatformHealthChannels,
  memory: MemoryPlatformHealthChannels,
});
