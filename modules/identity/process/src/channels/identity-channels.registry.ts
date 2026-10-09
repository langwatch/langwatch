import { defineChannels } from "@langwatch/process";

import { BoundIdentityChannels } from "./identity.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const identityChannels = defineChannels({
  live: BoundIdentityChannels,
  memory: BoundIdentityChannels,
});
