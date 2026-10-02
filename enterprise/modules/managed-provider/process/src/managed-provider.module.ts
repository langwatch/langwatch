import { defineProcessModule } from "@langwatch/process";

import { ManagedProviderModule } from "./app/managed-provider.app.ts";
import type { ManagedProviderCredentialVendor } from "./channels/managed-provider-credentials.channel.ts";
import type { ManagedProviderConfiguration } from "./services/managed-provider-configuration.service.ts";
import { ManagedProviderService } from "./services/managed-provider.service.ts";

export const managedProviderProcessModule = defineProcessModule("managed-provider")
  .withApi(ManagedProviderModule)
  .build();

/** The managed-provider capability, over the ports this process composed. */
export function createManagedProviderService(options: {
  configuration: ManagedProviderConfiguration;
  credentials: ManagedProviderCredentialVendor;
}): ManagedProviderService {
  return ManagedProviderService.create(options);
}
