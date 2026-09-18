/**
 * What a browser installs when it installs data-retention: the retention
 * schedule screen.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const dataRetentionWeb = defineWebModule("data-retention")
  .withHosts({
    requires: ["DataRetentionHostApi"],
    mounts: {
      DataRetentionHostApi: { load: () => import("./behavior/data-retention-host-mount.tsx") },
    },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/data-retention": {
      path: "/settings/data-retention",
      within: "settings",
      label: "Data Retention",
      load: () => import("./ui/sections/data-retention.screen.tsx"),
    },
  });
