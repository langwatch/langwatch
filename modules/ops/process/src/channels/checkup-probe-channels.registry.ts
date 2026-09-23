import { HttpCheckupProbeChannel } from "./http/http.checkup-probe.channel.ts";
import { MemoryCheckupProbeChannel } from "./memory/memory.checkup-probe.channel.ts";

/** Where the checkup's HTTP probes go. */
export const checkupProbeChannels = {
  live: HttpCheckupProbeChannel,
  memory: MemoryCheckupProbeChannel,
};
