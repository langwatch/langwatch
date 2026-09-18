/**
 * What a browser installs when it installs authz: the RBAC settings family
 * — Roles and Role Bindings.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const authzWeb = defineWebModule("authz").withScreens({
  // Placed by the application's settings table until a settings anchor
  // accepts declared routes; the loader is this module's either way.
  "pages/settings/roles": {
    path: "/settings/roles",
    within: "settings",
    label: "Roles",
    load: () => import("./ui/sections/roles.screen.tsx"),
  },
  "pages/settings/role-bindings": {
    path: "/settings/role-bindings",
    within: "settings",
    label: "Role Bindings",
    load: () => import("./ui/sections/role-bindings.screen.tsx"),
  },
});
