import { defineChannels } from "@langwatch/process";

import { BoundAuthzChannels } from "./authz.channels.ts";
import { MemoryAuthzChannels } from "./memory/memory.authz.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const authzChannels = defineChannels({
  live: BoundAuthzChannels,
  memory: MemoryAuthzChannels,
});
