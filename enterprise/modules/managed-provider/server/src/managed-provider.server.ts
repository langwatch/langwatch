import { defineFeature } from "@langwatch/runtime-composition";
import { ManagedProviderApp } from "./app/managed-provider.app.ts";

export type { ManagedProviderInfrastructure } from "./app/managed-provider.app.ts";

export const managedProviderServer = defineFeature("managed-provider")
  .withApp(ManagedProviderApp)
  .build();
