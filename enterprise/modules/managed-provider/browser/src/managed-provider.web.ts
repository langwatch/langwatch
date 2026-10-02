/**
 * What a browser installs when it installs managed-provider: the alert a
 * model-provider screen shows where the credentials are not the customer's.
 */

import { defineBrowserModule } from "@langwatch/browser";

export const managedProviderWeb = defineBrowserModule("managed-provider").withCapabilities({
  managedModelProviderAlert: {
    load: async () => ({
      default: (await import("./ui/sections/managed-provider-alert/index.ts"))
        .ManagedModelProviderAlert,
    }),
  },
});
