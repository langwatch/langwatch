import { HttpPresidioChannel } from "./http/http.presidio.channel.ts";
import { MemoryPresidioChannel } from "./memory/memory.presidio.channel.ts";

/** The two tiers behind `PresidioChannel`. */
export const presidioChannels = {
  live: HttpPresidioChannel,
  memory: MemoryPresidioChannel,
};
