import { defineChannels } from "@langwatch/process";

import { HttpManagedProviderChannels } from "./http/http.managed-provider.channels.ts";
import { MemoryManagedProviderChannels } from "./memory/memory.managed-provider.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const managedProviderChannels = defineChannels({
  live: HttpManagedProviderChannels,
  memory: MemoryManagedProviderChannels,
});
