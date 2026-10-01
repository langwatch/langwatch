/**
 * What a browser installs when it installs organization: the Directory
 * (members, teams, groups) and Audit Log settings screens, and the two surfaces
 * annotation and project mount today.
 */

import { planTrpc } from "@langwatch/entitlement-contract";
import { organizationTrpc } from "@langwatch/organization-contract";
import { defineWebModule } from "@langwatch/ui-kernel";

import { organizationApi } from "./behavior/organization-api.ts";

export const organizationWeb = defineWebModule("organization")
  // The api reads plan.getActivePlan too, so the plan's tier travels with it.
  .withApi(organizationApi, { contracts: [organizationTrpc, planTrpc] })
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
      requires: "organization:manage",
      load: () => import("./ui/sections/organization/audit-log.screen.tsx"),
    },
    // Members, Teams and Groups are the Directory's tabs; their old addresses redirect.
    "pages/settings/directory": {
      path: "/settings/directory",
      within: "settings",
      label: "Directory",
      load: () => import("./ui/sections/organization/directory.screen.tsx"),
    },
    "pages/settings/authentication": {
      path: "/settings/authentication",
      within: "settings",
      label: "Authentication",
      requires: "sso:view",
      load: () =>
        import("./features/authentication-settings/ui/sections/authentication-settings.screen.tsx"),
    },
    "pages/settings/teams/[team]": {
      path: "/settings/teams/:team",
      within: "settings",
      requires: "team:view",
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
    /** One member, from the members list: `?drawer.open=person&drawer.userId=…`. */
    person: {
      load: async () => ({
        default: (await import("./ui/sections/person-drawer.tsx")).PersonDrawer,
      }),
    },
  })
  /**
   * The post-login join offer the shell renders over a dashboard (and the
   * onboarding welcome): it RUNS joinRequests queries, so it is declared, not kitted.
   */
  .withCapabilities({
    /** Where they are standing: the composition root awaits this before it renders. */
    scope: { load: () => import("./behavior/scope-capability.ts") },
    /** Where the reader could replicate a thing to, graded per project (§10.1). */
    copyTargets: { load: () => import("./behavior/copy-targets-capability.ts") },
    /** The organization graph the chrome draws its switchers from. */
    organizationFacts: { load: () => import("./behavior/ui-organization-facts.ts") },
    joinOffer: {
      load: () => import("./features/join-offer/ui/sections/join-your-team-takeover.tsx"),
    },
    /** Shown in place of the dashboard body to a member on none of its teams. */
    teamAccessWaiting: { load: () => import("./ui/sections/team-access-waiting.tsx") },
    /** People waiting at the door, lent to project's home for those who can answer (§3.4 r7). */
    pendingJoinRequests: {
      load: async () => ({
        default: (await import("./ui/sections/pending-join-requests.tsx")).PendingJoinRequests,
      }),
    },
    /** A project's department row, lent to project's settings form (§3.4 rule 7). */
    projectDepartmentField: {
      load: async () => ({
        default: (await import("./ui/sections/project-department-field.tsx"))
          .ProjectDepartmentField,
      }),
    },
  });
