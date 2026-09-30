/**
 * What a browser installs when it installs user: the personal workspace a
 * person opens on themselves (overview, configure, sessions, pull requests,
 * budget request) and the account's Profile and Security settings screens.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const userWeb = defineWebModule("user")
  .withHosts({
    requires: ["PersonalWorkspaceHostApi"],
    mounts: {
      PersonalWorkspaceHostApi: {
        load: () => import("./behavior/personal-workspace-host-mount.tsx"),
      },
    },
  })
  .withScreens({
    "pages/me/index": {
      path: "/me",
      flags: ["release_ui_ai_governance_enabled"],
      load: () => import("./ui/sections/personal-workspace/personal-overview.screen.tsx"),
    },
    "pages/me/configure": {
      path: "/me/configure",
      flags: ["release_ui_ai_governance_enabled"],
      load: () => import("./ui/sections/personal-workspace/personal-configure.screen.tsx"),
    },
    "pages/me/pull-requests": {
      path: "/me/pull-requests",
      flags: ["release_ui_ai_governance_enabled"],
      load: () => import("./ui/sections/personal-workspace/personal-pull-requests.screen.tsx"),
    },
    "pages/me/sessions": {
      path: "/me/sessions",
      flags: ["release_ui_ai_governance_enabled"],
      load: () => import("./ui/sections/personal-workspace/personal-sessions.screen.tsx"),
    },
    "pages/me/budget/request": {
      path: "/me/budget/request",
      flags: ["release_ui_ai_governance_enabled"],
      load: () => import("./ui/sections/personal-workspace/personal-budget-request.screen.tsx"),
    },
    // The same two workspaces scoped to one project; the application's table
    // owns these addresses, so only the loader is declared here.
    "pages/[project]/sessions": {
      flags: ["release_ui_ai_governance_enabled"],
      load: () => import("./ui/sections/personal-workspace/project-sessions.screen.tsx"),
    },
    "pages/[project]/pull-requests": {
      flags: ["release_ui_ai_governance_enabled"],
      load: () => import("./ui/sections/personal-workspace/project-pull-requests.screen.tsx"),
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
  /** The account-security offer the shell draws after the join offer resolves to nothing. */
  .withCapabilities({
    secureAccountNudge: { load: () => import("./ui/sections/secure-account-nudge.tsx") },
    /** An organization's second-factor requirement, drawn in place of the page body (D06). */
    organizationMfaGate: {
      load: () => import("./features/two-step-verification/ui/sections/organization-mfa-gate.tsx"),
    },
  })
  /** What another module may mount. governance reads the tile icon for its tool cards. */
  .publishSurfaces({
    "surfaces/tile-icon": { load: () => import("./ui/elements/tile-icon.tsx") },
  });
