import { HttpTraceCollectorChannel } from "./http/http.trace-collector.channel.ts";
import { MemoryTraceCollectorChannel } from "./memory/memory.trace-collector.channel.ts";

/** Where the hotel bot's traces are posted. */
export const traceCollectorChannels = {
  live: HttpTraceCollectorChannel,
  memory: MemoryTraceCollectorChannel,
};
