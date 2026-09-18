/**
 * What a browser installs when it installs gateway: the host its screens
 * read, and the drawers the address bar opens (`?drawer.open=<name>`),
 * under the names the product has always used.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const gatewayWeb = defineWebModule("gateway")
  .withHosts({
    requires: ["GatewayHostApi"],
    mounts: { GatewayHostApi: { load: () => import("./behavior/gateway-host-mount.tsx") } },
  })
  .withScreens({
    "pages/gateway/virtual-keys": {
      load: () => import("./ui/sections/gateway/gateway-virtual-keys.screen.tsx"),
    },
    "pages/gateway/virtual-keys/[id]": {
      load: () => import("./ui/sections/gateway/gateway-virtual-key.screen.tsx"),
    },
    "pages/gateway/budgets": {
      load: () => import("./ui/sections/gateway/gateway-budgets.screen.tsx"),
    },
    "pages/gateway/budgets/[id]": {
      load: () => import("./ui/sections/gateway/gateway-budget.screen.tsx"),
    },
    "pages/gateway/routing-policies": {
      load: () => import("./ui/sections/gateway/gateway-routing-policies.screen.tsx"),
    },
    "pages/gateway/usage": {
      load: () => import("./ui/sections/gateway/gateway-usage.screen.tsx"),
    },
    "pages/gateway/cache-rules": {
      load: () => import("./ui/sections/gateway/gateway-cache-rules.screen.tsx"),
    },
    "pages/gateway/guardrails": {
      load: () => import("./ui/sections/gateway/gateway-guardrails.screen.tsx"),
    },
    "pages/gateway/billing-events": {
      load: () => import("./ui/sections/gateway/gateway-billing-events.screen.tsx"),
    },
    "pages/gateway/webhooks": {
      load: () => import("./ui/sections/gateway/gateway-webhooks.screen.tsx"),
    },
  })
  .withDrawers({
    routingPolicy: {
      load: async () => ({
        default: (await import("./features/routing-policies/ui/sections/routing-policy-drawer.tsx"))
          .RoutingPolicyDrawer,
      }),
    },
  });
