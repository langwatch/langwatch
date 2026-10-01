import { HttpsSsoIssuerDiscoveryChannel } from "./http/http.sso-issuer-discovery.channel.ts";
import { MemorySsoIssuerDiscoveryChannel } from "./memory/memory.sso-issuer-discovery.channel.ts";

/** Whether an issuer an administrator typed answers as one (D09). */
export const ssoIssuerDiscoveryChannels = {
  live: HttpsSsoIssuerDiscoveryChannel,
  memory: MemorySsoIssuerDiscoveryChannel,
};
