/**
 * What a browser installs when it installs secret: the project Secrets
 * settings screen.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

import { withSecretHost } from "./behavior/secret-host-mount.tsx";

export const secretWeb = defineWebModule("secret")
  .withHosts({ requires: ["SecretHostApi"], mounts: ["SecretHostApi"] })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/secrets": {
      path: "/settings/secrets",
      within: "settings",
      label: "Secrets",
      load: async () => ({
        default: withSecretHost((await import("./ui/sections/secrets-screen.tsx")).default),
      }),
    },
  });
