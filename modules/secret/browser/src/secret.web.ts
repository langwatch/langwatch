/**
 * What a browser installs when it installs secret: the project Secrets
 * settings screen.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const secretWeb = defineWebModule("secret")
  .withHosts({
    requires: ["SecretHostApi"],
    mounts: { SecretHostApi: { load: () => import("./behavior/secret-host-mount.tsx") } },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/secrets": {
      path: "/settings/secrets",
      within: "settings",
      label: "Secrets",
      load: () => import("./ui/sections/secrets-screen.tsx"),
    },
  });
