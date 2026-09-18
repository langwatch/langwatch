/**
 * What a browser installs when it installs data-privacy: the redaction
 * rules screen.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const dataPrivacyWeb = defineWebModule("data-privacy")
  .withHosts({
    requires: ["DataPrivacyHostApi"],
    mounts: {
      DataPrivacyHostApi: { load: () => import("./behavior/data-privacy-host-mount.tsx") },
    },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/data-privacy": {
      path: "/settings/data-privacy",
      within: "settings",
      label: "Data Privacy",
      load: () => import("./ui/sections/data-privacy-screen.tsx"),
    },
  });
