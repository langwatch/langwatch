import { defineChannels } from "@langwatch/process";

import { BoundUserChannels } from "./user.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const userChannels = defineChannels({
  live: BoundUserChannels,
  memory: BoundUserChannels,
});
