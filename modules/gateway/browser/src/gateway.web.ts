/**
 * What a browser installs when it installs gateway: the drawers the address
 * bar opens (`?drawer.open=<name>`), under the names the product has always
 * used.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const gatewayWeb = defineWebModule("gateway").withDrawers({
  routingPolicy: {
    load: async () => ({
      default: (await import("./features/routing-policies/ui/sections/routing-policy-drawer.tsx"))
        .RoutingPolicyDrawer,
    }),
  },
});
