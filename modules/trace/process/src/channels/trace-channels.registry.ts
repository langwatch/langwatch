import { defineChannels } from "@langwatch/process";

import { HttpTraceChannels } from "./http/http.trace.channels.ts";
import { MemoryTraceChannels } from "./memory/memory.trace.channels.ts";

/** The container builds the tier the stores state and hands it to the module class (§5). */
export const traceChannels = defineChannels({
  live: HttpTraceChannels,
  memory: MemoryTraceChannels,
});
