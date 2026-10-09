import { defineChannels } from "@langwatch/process";

import { HttpIdentityChannels } from "./http/http.identity.channels.ts";
import { MemoryIdentityChannels } from "./memory/memory.identity.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const identityChannels = defineChannels({
  live: HttpIdentityChannels,
  memory: MemoryIdentityChannels,
});
