import { defineProcessModule } from "@langwatch/process";

import { ManagedProviderModule } from "./app/managed-provider.app.ts";

export const managedProviderProcessModule = defineProcessModule("managed-provider")
  .withApi(ManagedProviderModule)
  .build();
