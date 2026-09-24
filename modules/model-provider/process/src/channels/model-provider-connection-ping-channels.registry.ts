import { HttpModelProviderConnectionPingChannel } from "./http/http.model-provider-connection-ping.channel.ts";
import { MemoryModelProviderConnectionPingChannel } from "./memory/memory.model-provider-connection-ping.channel.ts";

/** The two tiers behind `ModelProviderConnectionPing`. */
export const modelProviderConnectionPingChannels = {
  live: HttpModelProviderConnectionPingChannel,
  memory: MemoryModelProviderConnectionPingChannel,
};
