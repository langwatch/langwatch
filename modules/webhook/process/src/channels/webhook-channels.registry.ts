import { defineChannels } from "@langwatch/process";

import { HttpWebhookChannels } from "./http/http.webhook.channels.ts";
import { MemoryWebhookChannels } from "./memory/memory.webhook.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const webhookChannels = defineChannels({
  live: HttpWebhookChannels,
  memory: MemoryWebhookChannels,
});
