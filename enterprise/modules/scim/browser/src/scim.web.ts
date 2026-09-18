/**
 * What a browser installs when it installs scim: the SCIM Provisioning
 * settings screen. Always installed — scim refuses per-organization on
 * entitlement, it never gates itself by tier.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const scimWeb = defineWebModule("scim")
  .withHosts({
    requires: ["ScimHostApi"],
    mounts: { ScimHostApi: { load: () => import("./behavior/scim-host-mount.tsx") } },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/scim": {
      path: "/settings/scim",
      within: "settings",
      label: "SCIM Provisioning",
      load: () => import("./ui/sections/scim.screen.tsx"),
    },
  });
