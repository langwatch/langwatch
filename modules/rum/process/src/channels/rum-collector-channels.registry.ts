import { HttpRumCollectorChannel } from "./http/http.rum-collector.channel.ts";
import { MemoryRumCollectorChannel } from "./memory/memory.rum-collector.channel.ts";

/** The two tiers behind `RumCollectorChannel`. */
export const rumCollectorChannels = {
  live: HttpRumCollectorChannel,
  memory: MemoryRumCollectorChannel,
};
