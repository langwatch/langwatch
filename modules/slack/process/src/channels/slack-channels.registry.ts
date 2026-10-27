import { defineChannels } from "@langwatch/process";

import { HttpSlackChannels } from "./http/http.slack.channels.ts";
import { MemorySlackChannels } from "./memory/memory.slack.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const slackChannels = defineChannels({
  live: HttpSlackChannels,
  memory: MemorySlackChannels,
});
