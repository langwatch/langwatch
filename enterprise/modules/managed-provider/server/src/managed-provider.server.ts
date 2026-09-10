import { defineServerModule } from "@langwatch/runtime-composition";
import { ManagedProviderApp } from "./app/managed-provider.app.ts";

export type { ManagedProviderInfrastructure } from "./app/managed-provider.app.ts";

export const managedProviderServer = defineServerModule("managed-provider")
  .withApp(ManagedProviderApp)
  .build();
