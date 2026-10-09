import { defineChannels } from "@langwatch/process";

import { HttpRumChannels } from "./http/http.rum.channels.ts";
import { MemoryRumChannels } from "./memory/memory.rum.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const rumChannels = defineChannels({
  live: HttpRumChannels,
  memory: MemoryRumChannels,
});
