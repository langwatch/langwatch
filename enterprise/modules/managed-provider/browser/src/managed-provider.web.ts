/**
 * What a browser installs when it installs managed-provider: the alert a
 * model-provider screen shows where the credentials are not the customer's.
 */

import { defineBrowserModule } from "@langwatch/browser";
import { ManagedModelProviderAlertToken } from "@langwatch/enterprise-managed-provider-contract";

export const managedProviderWeb = defineBrowserModule("managed-provider").lends(
  ManagedModelProviderAlertToken,
  {
    load: async () => ({
      default: (await import("./ui/sections/managed-provider-alert/index.ts"))
        .ManagedModelProviderAlert,
    }),
  },
);
