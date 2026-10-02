/**
 * What a browser installs when it installs ops: the operator screens the
 * route table addresses, and the drawers the address bar opens
 * (`?drawer.open=<name>`), under the names the product has always used.
 */

import { defineBrowserModule } from "@langwatch/browser";

export const opsWeb = defineBrowserModule("ops")
  .withHosts({
    requires: ["OpsHostApi", "CheckupHostApi"],
    mounts: {
      OpsHostApi: { load: () => import("./behavior/ops-host-mount.tsx") },
      CheckupHostApi: {
        load: () => import("./features/checkup/behavior/checkup-host-mount.tsx"),
      },
    },
  })
  .withScreens({
    // Placed by the application's settings table beside License and Connect.
    "pages/settings/checkup": {
      path: "/settings/checkup",
      within: "settings",
      label: "Checkup",
      load: () => import("./features/checkup/ui/sections/checkup.screen.tsx"),
    },
    "pages/ops/index": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-dashboard.screen.tsx"),
    },
    "pages/ops/dejaview": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-deja-view.screen.tsx"),
    },
    "pages/ops/event-sourcing/index": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-event-sourcing.screen.tsx"),
    },
    "pages/ops/event-sourcing/dead-letters": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-dead-letters.screen.tsx"),
    },
    "pages/ops/event-sourcing/processes": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-processes.screen.tsx"),
    },
    "pages/ops/event-sourcing/projections": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-projections.screen.tsx"),
    },
    "pages/ops/event-sourcing/subscribers": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-subscribers.screen.tsx"),
    },
    "pages/ops/event-sourcing/schedules": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-schedules.screen.tsx"),
    },
    "pages/ops/blobs": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-payload-store.screen.tsx"),
    },
    "pages/ops/feature-flags": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-feature-flags.screen.tsx"),
    },
    "pages/ops/foundry": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-foundry.screen.tsx"),
    },
    "pages/ops/migrations": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-migrations.screen.tsx"),
    },
    "pages/ops/projections/[runId]": {
      requires: "ops:view",
      load: () => import("./ui/sections/ops/ops-replay-progress.screen.tsx"),
    },
    "pages/ops/operators": {
      requires: "ops:manage",
      load: () => import("./ui/sections/ops/ops-operators.screen.tsx"),
    },
    "pages/ops/users": {
      requires: "ops:manage",
      load: async () => ({
        default: (await import("./ui/sections/ops/admin-screens.tsx")).UsersScreen,
      }),
    },
    "pages/ops/organizations": {
      requires: "ops:manage",
      load: async () => ({
        default: (await import("./ui/sections/ops/admin-screens.tsx")).OrganizationsScreen,
      }),
    },
    "pages/ops/projects": {
      requires: "ops:manage",
      load: async () => ({
        default: (await import("./ui/sections/ops/admin-screens.tsx")).ProjectsScreen,
      }),
    },
    "pages/ops/sso-connections": {
      requires: "ops:manage",
      load: async () => ({
        default: (await import("./ui/sections/ops/admin-screens.tsx")).SsoConnectionsScreen,
      }),
    },
    "pages/ops/identity-lookup": {
      requires: "ops:manage",
      load: async () => ({
        default: (await import("./ui/sections/ops/admin-screens.tsx")).IdentityLookupScreen,
      }),
    },
    "pages/ops/cloud/subscriptions": {
      requires: "ops:manage",
      load: async () => ({
        default: (await import("./ui/sections/ops/admin-screens.tsx")).CloudSubscriptionsScreen,
      }),
    },
    "pages/ops/cloud/licenses": {
      requires: "ops:manage",
      load: async () => ({
        default: (await import("./ui/sections/ops/admin-screens.tsx")).CloudLicensesScreen,
      }),
    },
    "pages/ops/cloud/self-hosted-instances": {
      requires: "ops:manage",
      load: async () => ({
        default: (await import("./ui/sections/ops/admin-screens.tsx"))
          .CloudSelfHostedInstancesScreen,
      }),
    },
    "pages/ops/cloud/bug-reports": {
      requires: "ops:manage",
      load: async () => ({
        default: (await import("./ui/sections/ops/admin-screens.tsx")).CloudBugReportsScreen,
      }),
    },
  })
  .withDrawers({
    opsGroupDetail: {
      load: async () => ({
        default: (await import("./features/queue/ui/sections/group-detail-drawer.tsx"))
          .GroupDetailDrawer,
      }),
    },
    opsProcessInstance: {
      load: async () => ({
        default: (await import("./features/event-store/ui/sections/process-instance-drawer.tsx"))
          .ProcessInstanceDrawer,
      }),
    },
    opsProcessInstances: {
      load: async () => ({
        default: (await import("./features/event-store/ui/sections/process-instances-drawer.tsx"))
          .ProcessInstancesDrawer,
      }),
    },
    opsBlobs: {
      load: async () => ({
        default: (await import("./features/blob-store/ui/sections/ops-blobs-drawer.tsx"))
          .OpsBlobsDrawer,
      }),
    },
    opsReplay: {
      load: async () => ({
        default: (await import("./features/event-store/ui/sections/ops-replay-drawer.tsx"))
          .OpsReplayDrawer,
      }),
    },
    foundry: { load: () => import("./ui/sections/ops/ops-foundry-drawer.tsx") },
  })
  /** The header's impersonation banner, which the shell hands to navigation's headerBanner. */
  .withCapabilities({
    impersonationBanner: {
      load: async () => ({
        default: (await import("./ui/sections/impersonation/impersonation-header-banner.tsx"))
          .ImpersonationHeaderBanner,
      }),
    },
  });
