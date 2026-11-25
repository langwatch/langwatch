import { defineChannels } from "@langwatch/process";

import { BoundNotificationChannels } from "./notification.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const notificationChannels = defineChannels({
  live: BoundNotificationChannels,
  memory: BoundNotificationChannels,
});
