import { defineChannels } from "@langwatch/process";

import { HttpStoredObjectChannels } from "./http/http.stored-object.channels.ts";
import { MemoryStoredObjectChannels } from "./memory/memory.stored-object.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const storedObjectChannels = defineChannels({
  live: HttpStoredObjectChannels,
  memory: MemoryStoredObjectChannels,
});
