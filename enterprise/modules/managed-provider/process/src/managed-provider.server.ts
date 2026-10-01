import { defineServerModule } from "@langwatch/process";

import { ManagedProviderApp } from "./app/managed-provider.app.ts";
import type { ManagedProviderCredentialVendor } from "./channels/managed-provider-credentials.channel.ts";
import type { ManagedProviderConfiguration } from "./services/managed-provider-configuration.service.ts";
import { ManagedProviderService } from "./services/managed-provider.service.ts";

export const managedProviderServer = defineServerModule("managed-provider")
  .withApp(ManagedProviderApp)
  .build();

/** The managed-provider capability, over the ports this process composed. */
export function createManagedProviderService(options: {
  configuration: ManagedProviderConfiguration;
  credentials: ManagedProviderCredentialVendor;
}): ManagedProviderService {
  return ManagedProviderService.create(options);
}
