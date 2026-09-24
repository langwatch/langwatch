import { HttpLangevalsChannel } from "./http/http.langevals.channel.ts";
import { MemoryLangevalsChannel } from "./memory/memory.langevals.channel.ts";

/** The two tiers behind `LangevalsChannel`. */
export const langevalsChannels = {
  live: HttpLangevalsChannel,
  memory: MemoryLangevalsChannel,
};
