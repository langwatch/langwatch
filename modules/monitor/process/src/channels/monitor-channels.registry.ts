import { defineChannels } from "@langwatch/process";

import { BoundMonitorChannels } from "./monitor.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const monitorChannels = defineChannels({
  live: BoundMonitorChannels,
  memory: BoundMonitorChannels,
});
