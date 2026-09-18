/**
 * What a browser installs when it installs billing: the Plans, Subscription
 * and Usage settings screens. Always installed — billing refuses
 * per-organization on entitlement, it never gates itself by tier.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const billingWeb = defineWebModule("billing")
  .withHosts({
    requires: ["BillingHostApi"],
    mounts: { BillingHostApi: { load: () => import("./behavior/billing-host-mount.tsx") } },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/plans": {
      path: "/settings/plans",
      within: "settings",
      label: "Plans",
      load: () => import("./ui/sections/plans.screen.tsx"),
    },
    "pages/settings/subscription": {
      path: "/settings/subscription",
      within: "settings",
      label: "Subscription",
      load: () => import("./ui/sections/subscription.screen.tsx"),
    },
    "pages/settings/usage": {
      path: "/settings/usage",
      within: "settings",
      label: "Usage",
      load: () => import("./ui/sections/usage.screen.tsx"),
    },
  });
