import { defineChannels } from "@langwatch/process";

import { HttpOpsChannels } from "./http/http.ops.channels.ts";
import { MemoryOpsChannels } from "./memory/memory.ops.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const opsChannels = defineChannels({
  live: HttpOpsChannels,
  memory: MemoryOpsChannels,
});
