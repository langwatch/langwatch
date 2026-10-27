import { defineChannels } from "@langwatch/process";

import { HttpNurturingChannels } from "./http/http.nurturing.channels.ts";
import { MemoryNurturingChannels } from "./memory/memory.nurturing.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const nurturingChannels = defineChannels({
  live: HttpNurturingChannels,
  memory: MemoryNurturingChannels,
});
