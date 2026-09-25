/**
 * What a browser installs when it installs ops: the operator screens the
 * route table addresses, and the drawers the address bar opens
 * (`?drawer.open=<name>`), under the names the product has always used.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const opsWeb = defineWebModule("ops")
  .withHosts({
    requires: ["OpsHostApi", "CheckupHostApi"],
    mounts: {
      OpsHostApi: { load: () => import("./behavior/ops-host-mount.tsx") },
      CheckupHostApi: {
        load: () => import("./features/checkup/behavior/checkup-host-mount.tsx"),
      },
    },
  })
  // The install's one-time usage-report notice; the shell draws it where the page body starts.
  .withCapabilities({
    startupNotice: { load: () => import("./features/checkup/ui/sections/startup-notice.tsx") },
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
      load: () => import("./ui/sections/ops/ops-dashboard.screen.tsx"),
    },
    "pages/ops/dejaview": {
      load: () => import("./ui/sections/ops/ops-deja-view.screen.tsx"),
    },
    "pages/ops/event-sourcing/index": {
      load: () => import("./ui/sections/ops/ops-event-sourcing.screen.tsx"),
    },
    "pages/ops/event-sourcing/dead-letters": {
      load: () => import("./ui/sections/ops/ops-dead-letters.screen.tsx"),
    },
    "pages/ops/event-sourcing/processes": {
      load: () => import("./ui/sections/ops/ops-processes.screen.tsx"),
    },
    "pages/ops/event-sourcing/projections": {
      load: () => import("./ui/sections/ops/ops-projections.screen.tsx"),
    },
    "pages/ops/event-sourcing/subscribers": {
      load: () => import("./ui/sections/ops/ops-subscribers.screen.tsx"),
    },
    "pages/ops/event-sourcing/schedules": {
      load: () => import("./ui/sections/ops/ops-schedules.screen.tsx"),
    },
    "pages/ops/blobs": {
      load: () => import("./ui/sections/ops/ops-payload-store.screen.tsx"),
    },
    "pages/ops/feature-flags": {
      load: () => import("./ui/sections/ops/ops-feature-flags.screen.tsx"),
    },
    "pages/ops/foundry": {
      load: () => import("./ui/sections/ops/ops-foundry.screen.tsx"),
    },
    "pages/ops/migrations": {
      load: () => import("./ui/sections/ops/ops-migrations.screen.tsx"),
    },
    "pages/ops/projections/[runId]": {
      load: () => import("./ui/sections/ops/ops-replay-progress.screen.tsx"),
    },
    "pages/ops/backoffice/users": {
      load: async () => ({
        default: (await import("./ui/sections/ops/backoffice-screens.tsx")).BackofficeUsersScreen,
      }),
    },
    "pages/ops/backoffice/organizations": {
      load: async () => ({
        default: (await import("./ui/sections/ops/backoffice-screens.tsx"))
          .BackofficeOrganizationsScreen,
      }),
    },
    "pages/ops/backoffice/projects": {
      load: async () => ({
        default: (await import("./ui/sections/ops/backoffice-screens.tsx"))
          .BackofficeProjectsScreen,
      }),
    },
    "pages/ops/backoffice/subscriptions": {
      load: async () => ({
        default: (await import("./ui/sections/ops/backoffice-screens.tsx"))
          .BackofficeSubscriptionsScreen,
      }),
    },
    "pages/ops/backoffice/sso-connections": {
      load: async () => ({
        default: (await import("./ui/sections/ops/backoffice-screens.tsx"))
          .BackofficeSsoConnectionsScreen,
      }),
    },
    "pages/ops/backoffice/bug-reports": {
      load: async () => ({
        default: (await import("./ui/sections/ops/backoffice-screens.tsx"))
          .BackofficeBugReportsScreen,
      }),
    },
    "pages/ops/backoffice/licenses": {
      load: async () => ({
        default: (await import("./ui/sections/ops/backoffice-screens.tsx"))
          .BackofficeLicensesScreen,
      }),
    },
    "pages/ops/backoffice/self-hosted-instances": {
      load: async () => ({
        default: (await import("./ui/sections/ops/backoffice-screens.tsx"))
          .BackofficeSelfHostedInstancesScreen,
      }),
    },
    "pages/ops/backoffice/identity-lookup": {
      load: async () => ({
        default: (await import("./ui/sections/ops/backoffice-screens.tsx"))
          .BackofficeIdentityLookupScreen,
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
    foundry: {
      load: async () => ({
        default: (await import("./features/foundry/ui/sections/foundry-drawer.tsx")).FoundryDrawer,
      }),
    },
  });
