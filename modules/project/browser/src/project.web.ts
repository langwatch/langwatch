/**
 * What a browser installs when it installs project: the home a member
 * lands on, and the project settings page.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const projectWeb = defineWebModule("project")
  .withHosts({
    requires: ["ProjectHostApi", "ProjectHomeHost"],
    mounts: {
      ProjectHostApi: { load: () => import("./behavior/project-host-mount.tsx") },
      ProjectHomeHost: { load: () => import("./behavior/project-home-host-mount.tsx") },
    },
  })
  .withScreens({
    "pages/[project]/index": {
      path: "/:project",
      within: "project",
      label: "Home",
      load: () => import("./ui/sections/home/home-screen.tsx"),
    },
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings": {
      path: "/settings",
      within: "settings",
      label: "Project Settings",
      load: () => import("./ui/sections/project-settings/project-settings-screen.tsx"),
    },
  });
