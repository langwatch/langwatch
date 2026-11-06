/**
 * What a browser installs when it installs authz: the Roles & access settings
 * page, whose Access tab /settings/role-bindings now redirects to.
 */

import { authzWebConfigSchema } from "@langwatch/authz-contract";
import { defineBrowserModule } from "@langwatch/browser";

import { authzApi } from "./behavior/authz-api.ts";
import { RoleDetailDrawerToken } from "./model/role-detail-drawer.ts";

export const authzWeb = defineBrowserModule("authz")
  .withConfig({ authz: authzWebConfigSchema }, ({ authz }) => authz)
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
      // Every role reads it; its edits ask organization:manage on their own.
      requires: "members:view",
      requiresAt: "organization",
      load: () => import("./ui/sections/roles.screen.tsx"),
    },
  })
  /** What one role can do: `?drawer.open=roleDetail&drawer.role=<key or id>`. */
  .drawer(RoleDetailDrawerToken, {
    load: async () => ({
      default: (await import("./ui/sections/role-detail-drawer.tsx")).RoleDetailDrawer,
    }),
  });
