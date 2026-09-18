/**
 * What a browser installs when it installs user: the personal workspace a
 * person opens on themselves (overview, configure, sessions, pull requests,
 * budget request) and the account's Profile and Security settings screens.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const userWeb = defineWebModule("user")
  .withScreens({
    "pages/me/index": {
      path: "/me",
      load: () => import("./ui/sections/personal-workspace/personal-overview.screen.tsx"),
    },
    "pages/me/configure": {
      path: "/me/configure",
      load: () => import("./ui/sections/personal-workspace/personal-configure.screen.tsx"),
    },
    "pages/me/pull-requests": {
      path: "/me/pull-requests",
      load: () => import("./ui/sections/personal-workspace/personal-pull-requests.screen.tsx"),
    },
    "pages/me/sessions": {
      path: "/me/sessions",
      load: () => import("./ui/sections/personal-workspace/personal-sessions.screen.tsx"),
    },
    "pages/me/budget/request": {
      path: "/me/budget/request",
      load: () => import("./ui/sections/personal-workspace/personal-budget-request.screen.tsx"),
    },
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/profile": {
      path: "/settings/profile",
      within: "settings",
      label: "Profile",
      load: () => import("./ui/sections/personal-workspace/profile.screen.tsx"),
    },
    "pages/settings/security": {
      path: "/settings/security",
      within: "settings",
      label: "Security",
      load: () => import("./ui/sections/personal-workspace/security.screen.tsx"),
    },
  })
  /** What another module may mount. governance reads the tile icon for its tool cards. */
  .publishSurfaces({
    "surfaces/tile-icon": { load: () => import("./ui/elements/tile-icon.tsx") },
  });
