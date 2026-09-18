/**
 * What a browser installs when it installs github: the Integrations
 * settings screen, and the connect-popup surface the langy module mounts.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const githubWeb = defineWebModule("github")
  .withHosts({
    requires: ["GithubHostApi"],
    mounts: { GithubHostApi: { load: () => import("./behavior/github-host-mount.tsx") } },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/integrations": {
      path: "/settings/integrations",
      within: "settings",
      label: "Integrations",
      load: () => import("./ui/sections/integrations.screen.tsx"),
    },
  })
  /** What another module may mount. Today langy mounts the connect popup. */
  .publishSurfaces({
    "surfaces/github-connect-popup": { load: () => import("./behavior/github-connect-popup.ts") },
  });
