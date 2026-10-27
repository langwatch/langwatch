import type { ManagedProviderCredentialVendor } from "./managed-provider-credentials.channel.ts";

/** Every channel managed-provider holds, as the container hands them to the module class. */
export interface ManagedProviderChannels {
  readonly credentials: ManagedProviderCredentialVendor;
}
