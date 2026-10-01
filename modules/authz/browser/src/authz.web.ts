/**
 * What a browser installs when it installs authz: the Roles & access settings
 * page, whose Access tab /settings/role-bindings now redirects to.
 */

import { defineBrowserModule } from "@langwatch/browser";

import { authzApi } from "./behavior/authz-api.ts";

export const authzWeb = defineBrowserModule("authz")
  .withApi(authzApi)
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
      label: "Roles & access",
      requires: "organization:manage",
      load: () => import("./ui/sections/roles.screen.tsx"),
    },
  });
