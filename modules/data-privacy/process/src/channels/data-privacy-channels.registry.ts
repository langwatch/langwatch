import { defineChannels } from "@langwatch/process";

import { HttpDataPrivacyChannels } from "./http/http.data-privacy.channels.ts";
import { MemoryDataPrivacyChannels } from "./memory/memory.data-privacy.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const dataPrivacyChannels = defineChannels({
  live: HttpDataPrivacyChannels,
  memory: MemoryDataPrivacyChannels,
});
