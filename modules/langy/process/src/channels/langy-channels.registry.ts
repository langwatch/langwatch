import { defineChannels } from "@langwatch/process";

import { HttpLangyChannels } from "./http/http.langy.channels.ts";
import { MemoryLangyChannels } from "./memory/memory.langy.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const langyChannels = defineChannels({
  live: HttpLangyChannels,
  memory: MemoryLangyChannels,
});
