/**
 * What a browser installs when it installs scim: the provisioning screens, the
 * back office's directory sync, and the overview's directory card. Always
 * installed — scim refuses per-organization on entitlement, never by tier.
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
    "pages/settings/authentication/connectors": {
      path: "/settings/authentication/connectors",
      within: "settings",
      label: "Connectors",
      load: () => import("./ui/sections/connectors.screen.tsx"),
    },
    // The back office's directory sync across every customer; the server
    // answers operators only and refuses everyone else as not found.
    "pages/ops/backoffice/directory-sync": {
      load: () => import("./ui/sections/directory-sync-view.screen.tsx"),
    },
  })
  // How accounts arrive, drawn on organization's Authentication overview.
  .withCapabilities({
    authenticationOverviewCard: {
      load: () => import("./ui/sections/directory-overview-card.tsx"),
    },
  });
