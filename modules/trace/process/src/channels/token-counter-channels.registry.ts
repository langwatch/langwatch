import { HttpTokenCounterChannel } from "./http/http.token-counter.channel.ts";
import { MemoryTokenCounterChannel } from "./memory/memory.token-counter.channel.ts";

/** The two tiers behind `TraceTokenCounter`. */
export const tokenCounterChannels = {
  live: HttpTokenCounterChannel,
  memory: MemoryTokenCounterChannel,
};
