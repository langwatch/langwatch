import type { ManagedProviderApi } from "@langwatch/enterprise-managed-provider-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { ManagedProviderModule } from "./app/managed-provider.app.ts";
import { managedProviderChannels } from "./channels/managed-provider-channels.registry.ts";

export const managedProviderProcessModule: PublishedProcessModule<
  "managed-provider",
  ManagedProviderApi,
  undefined
> = defineProcessModule("managed-provider")
  .withChannels(managedProviderChannels)
  .withApi(ManagedProviderModule)
  .build();
