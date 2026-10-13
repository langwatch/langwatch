import { defineChannels } from "@langwatch/process";

import { BoundAnalyticsChannels } from "./analytics.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const analyticsChannels = defineChannels({
  live: BoundAnalyticsChannels,
  memory: BoundAnalyticsChannels,
});
