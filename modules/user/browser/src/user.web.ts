/**
 * What a browser installs when it installs user: the personal workspace a
 * person opens on themselves (overview, configure, sessions, pull requests,
 * budget request) and the account's Profile and Security settings screens.
 */

import { defineBrowserModule } from "@langwatch/browser";
import { FrontendFlags } from "@langwatch/feature-flag-contract";
import { CODING_AGENTS_PATH, userTrpc } from "@langwatch/user-contract";

import { personalWorkspaceApi } from "./behavior/personal-workspace-api.ts";

export const userWeb = defineBrowserModule("user")
  .withApi(personalWorkspaceApi, { contracts: [userTrpc] })
  .withHosts({
    requires: ["PersonalWorkspaceHostApi"],
    mounts: {
      PersonalWorkspaceHostApi: {
        load: () => import("./behavior/personal-workspace-host-mount.tsx"),
      },
    },
  })
  .withScreens({
    "pages/coding-agents/index": {
      path: CODING_AGENTS_PATH,
      flags: [FrontendFlags.release_ui_ai_governance_enabled],
      load: () => import("./ui/sections/personal-workspace/personal-overview.screen.tsx"),
    },
    "pages/coding-agents/configure": {
      path: `${CODING_AGENTS_PATH}/configure`,
      flags: [FrontendFlags.release_ui_ai_governance_enabled],
      load: () => import("./ui/sections/personal-workspace/personal-configure.screen.tsx"),
    },
    "pages/coding-agents/pull-requests": {
      path: `${CODING_AGENTS_PATH}/pull-requests`,
      flags: [FrontendFlags.release_ui_ai_governance_enabled],
      load: () => import("./ui/sections/personal-workspace/personal-pull-requests.screen.tsx"),
    },
    "pages/coding-agents/sessions": {
      path: `${CODING_AGENTS_PATH}/sessions`,
      flags: [FrontendFlags.release_ui_ai_governance_enabled],
      load: () => import("./ui/sections/personal-workspace/personal-sessions.screen.tsx"),
    },
    "pages/coding-agents/budget/request": {
      path: `${CODING_AGENTS_PATH}/budget/request`,
      flags: [FrontendFlags.release_ui_ai_governance_enabled],
      load: () => import("./ui/sections/personal-workspace/personal-budget-request.screen.tsx"),
    },
    // The same two workspaces scoped to one project; the application's table
    // owns these addresses, so only the loader is declared here.
    "pages/[project]/sessions": {
      flags: [FrontendFlags.release_ui_ai_governance_enabled],
      load: () => import("./ui/sections/personal-workspace/project-sessions.screen.tsx"),
    },
    "pages/[project]/pull-requests": {
      flags: [FrontendFlags.release_ui_ai_governance_enabled],
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
  });
