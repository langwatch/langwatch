import { defineChannels } from "@langwatch/process";

import { BoundApiKeyChannels } from "./api-key.channels.ts";
import { MemoryApiKeyChannels } from "./memory/memory.api-key.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const apiKeyChannels = defineChannels({
  live: BoundApiKeyChannels,
  memory: MemoryApiKeyChannels,
});
