import type { ManagedProviderApi } from "@langwatch/enterprise-managed-provider-contract";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";

import { ManagedProviderModule } from "./app/managed-provider.app.ts";

export const managedProviderProcessModule: PublishedProcessModule<
  "managed-provider",
  ManagedProviderApi,
  undefined
> = defineProcessModule("managed-provider").withApi(ManagedProviderModule).build();
