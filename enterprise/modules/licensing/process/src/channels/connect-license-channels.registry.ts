import { HttpConnectLicenseChannel } from "./http/http.connect-license.channel.ts";
import { MemoryConnectLicenseChannel } from "./memory/memory.connect-license.channel.ts";

/** The two tiers behind `ConnectLicenseChannel`. */
export const connectLicenseChannels = {
  live: HttpConnectLicenseChannel,
  memory: MemoryConnectLicenseChannel,
};
