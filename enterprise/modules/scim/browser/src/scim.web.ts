/**
 * What a browser installs when it installs scim: the connectors screen, the back
 * office's directory sync, the overview's directory card and the Directory's status
 * band. Always installed — scim refuses per-organization on entitlement, never by tier.
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
    "pages/settings/authentication/connectors": {
      path: "/settings/authentication/connectors",
      within: "settings",
      label: "Connectors",
      load: () => import("./ui/sections/connectors.screen.tsx"),
    },
    // Ops' directory sync across every customer; the server answers
    // operators only and refuses everyone else as not found.
    "pages/ops/directory-sync": {
      load: () => import("./ui/sections/directory-sync-view.screen.tsx"),
    },
  })
  // How accounts arrive, drawn on organization's Authentication overview.
  .withCapabilities({
    authenticationOverviewCard: {
      load: () => import("./ui/sections/directory-overview-card.tsx"),
    },
    // What the directory has been doing, above organization's Directory tabs.
    directorySummary: { load: () => import("./ui/sections/directory-summary.tsx") },
  });
