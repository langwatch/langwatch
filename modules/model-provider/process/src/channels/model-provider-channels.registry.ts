import { defineChannels } from "@langwatch/process";

import { HttpModelProviderChannels } from "./http/http.model-provider.channels.ts";
import { MemoryModelProviderChannels } from "./memory/memory.model-provider.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const modelProviderChannels = defineChannels({
  live: HttpModelProviderChannels,
  memory: MemoryModelProviderChannels,
});
