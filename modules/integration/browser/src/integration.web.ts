/** What a browser installs for integration: the Integrations screen and its GitHub host. */

import { defineBrowserModule } from "@langwatch/browser";

export const integrationWeb = defineBrowserModule("integration")
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
      requires: "organization:view",
      load: () => import("./ui/sections/integrations.screen.tsx"),
    },
  });
