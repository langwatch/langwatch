import { HttpManagedProviderCredentialsChannel } from "./http/http.managed-provider-credentials.channel.ts";
import { MemoryManagedProviderCredentialsChannel } from "./memory/memory.managed-provider-credentials.channel.ts";

/**
 * The two tiers behind `ManagedProviderCredentialVendor`.
 *
 * Plain object rather than `defineChannels({ live, memory })` from
 * `@langwatch/eventing`: that helper is still landing (ADR-144's channel
 * layer). This is the same `{ live, memory }` shape `defineChannels` will
 * take, so wiring it through later is a one-line swap, not a redesign.
 */
export const managedProviderCredentialsChannels = {
  live: HttpManagedProviderCredentialsChannel,
  memory: MemoryManagedProviderCredentialsChannel,
};
