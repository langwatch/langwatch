import { HttpManagedProviderCredentialsChannel } from "./http/http.managed-provider-credentials.channel.ts";
import { MemoryManagedProviderCredentialsChannel } from "./memory/memory.managed-provider-credentials.channel.ts";

/** The two tiers behind `ManagedProviderCredentialVendor`. */
export const managedProviderCredentialsChannels = {
  live: HttpManagedProviderCredentialsChannel,
  memory: MemoryManagedProviderCredentialsChannel,
};
