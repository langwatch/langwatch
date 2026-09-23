/**
 * What a browser installs when it installs organization: the Members,
 * Teams, Groups and Audit Log settings screens, and the two surfaces
 * annotation and project mount today.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const organizationWeb = defineWebModule("organization")
  .withHosts({
    requires: ["OrganizationHostApi"],
    mounts: {
      OrganizationHostApi: { load: () => import("./behavior/organization-host-mount.tsx") },
    },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/audit-log": {
      path: "/settings/audit-log",
      within: "settings",
      label: "Audit Log",
      load: () => import("./ui/sections/organization/audit-log.screen.tsx"),
    },
    "pages/settings/members": {
      path: "/settings/members",
      within: "settings",
      label: "Members",
      load: () => import("./ui/sections/organization/members.screen.tsx"),
    },
    "pages/settings/authentication": {
      path: "/settings/authentication",
      within: "settings",
      label: "Authentication",
      load: () =>
        import("./features/authentication-settings/ui/sections/authentication-settings.screen.tsx"),
    },
    "pages/settings/groups": {
      path: "/settings/groups",
      within: "settings",
      label: "Groups",
      load: () => import("./ui/sections/organization/groups.screen.tsx"),
    },
    "pages/settings/teams": {
      path: "/settings/teams",
      within: "settings",
      label: "Teams",
      load: () => import("./ui/sections/organization/teams.screen.tsx"),
    },
    "pages/settings/teams/[team]": {
      path: "/settings/teams/:team",
      within: "settings",
      load: () => import("./ui/sections/organization/team-detail.screen.tsx"),
    },
  })
  /**
   * What another module may mount. annotation reads the feature gate;
   * project mounts the department picker.
   */
  .withDrawers({
    createProject: {
      load: async () => ({
        default: (await import("./ui/sections/create-project-drawer.tsx")).CreateProjectDrawer,
      }),
    },
    editProject: {
      load: async () => ({
        default: (await import("./ui/sections/edit-project-drawer.tsx")).EditProjectDrawer,
      }),
    },
    createTeam: {
      load: async () => ({
        default: (await import("./ui/sections/create-team-drawer.tsx")).CreateTeamDrawer,
      }),
    },
    inviteMember: {
      load: async () => ({
        default: (await import("./ui/sections/invite-member-drawer.tsx")).InviteMemberDrawer,
      }),
    },
  })
  /**
   * The post-login join offer the shell renders over a dashboard (and the
   * onboarding welcome): it RUNS joinRequests queries, so it is declared, not kitted.
   */
  .withCapabilities({
    joinOffer: {
      load: () => import("./features/join-offer/ui/sections/join-your-team-takeover.tsx"),
    },
    /** Shown in place of the dashboard body to a member on none of its teams. */
    teamAccessWaiting: { load: () => import("./ui/sections/team-access-waiting.tsx") },
  })
  .publishSurfaces({
    "surfaces/personal-workspace-features": {
      load: () => import("./behavior/personal-workspace-features-api.ts"),
    },
    "surfaces/department-picker": { load: () => import("./department-picker.ts") },
  });
