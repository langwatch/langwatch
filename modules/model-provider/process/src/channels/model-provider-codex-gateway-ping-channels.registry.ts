import { HttpModelProviderCodexGatewayPingChannel } from "./http/http.model-provider-codex-gateway-ping.channel.ts";
import { MemoryModelProviderCodexGatewayPingChannel } from "./memory/memory.model-provider-codex-gateway-ping.channel.ts";

/** The two tiers behind `ModelProviderCodexGatewayPing`. */
export const modelProviderCodexGatewayPingChannels = {
  live: HttpModelProviderCodexGatewayPingChannel,
  memory: MemoryModelProviderCodexGatewayPingChannel,
};
