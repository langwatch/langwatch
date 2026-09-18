/**
 * What a browser installs when it installs project: the home a member
 * lands on, the project settings page, and the tech-stack surface the
 * onboarding module mounts.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const projectWeb = defineWebModule("project")
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
  })
  /** What another module may mount. Today onboarding mounts the tech-stack picker. */
  .publishSurfaces({
    "surfaces/tech-stack": { load: () => import("./ui/blocks/tech-stack.tsx") },
  });
