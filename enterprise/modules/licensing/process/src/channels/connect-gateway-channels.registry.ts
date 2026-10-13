import { HttpConnectGatewayChannel } from "./http/http.connect-gateway.channel.ts";
import { MemoryConnectGatewayChannel } from "./memory/memory.connect-gateway.channel.ts";

/** The two tiers behind `ConnectGatewayChannel`. */
export const connectGatewayChannels = {
  live: HttpConnectGatewayChannel,
  memory: MemoryConnectGatewayChannel,
};
