/**
 * What a browser installs when it installs authz: the Roles settings page,
 * whose assignments tab /settings/role-bindings now redirects to.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

import { authzApi } from "./behavior/authz-api.ts";

export const authzWeb = defineWebModule("authz")
  // authzTrpc lives in authz/process (a cycle from here), so its one tier is stated.
  .withApi(authzApi, {
    contracts: [
      { namespace: "authz", members: { effectivePermissions: { cache: { tier: "session" } } } },
    ],
  })
  .withHosts({
    requires: ["AuthzHostApi"],
    mounts: { AuthzHostApi: { load: () => import("./behavior/authz-host-mount.tsx") } },
  })
  .withScreens({
    // Placed by the application's settings table until a settings anchor
    // accepts declared routes; the loader is this module's either way.
    "pages/settings/roles": {
      path: "/settings/roles",
      within: "settings",
      label: "Roles",
      requires: "organization:manage",
      load: () => import("./ui/sections/roles.screen.tsx"),
    },
  });
