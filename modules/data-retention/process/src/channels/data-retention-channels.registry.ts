import { defineChannels } from "@langwatch/process";

import { BoundDataRetentionChannels } from "./data-retention.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const dataRetentionChannels = defineChannels({
  live: BoundDataRetentionChannels,
  memory: BoundDataRetentionChannels,
});
