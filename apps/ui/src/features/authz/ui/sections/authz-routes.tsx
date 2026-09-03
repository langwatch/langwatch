/**
 * Which page keys the RBAC settings addresses answer. Both guard on
 * `organization:manage`, not a member-inherited permission — a past
 * regression let a member session read the whole organization.
 */

import { AUTHZ_MANAGE_PERMISSION, authzScreens } from "@langwatch/authz-web/screens/authz";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { AuthzHost } from "./authz-host";

export const authzPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/roles": uiPage({
    screen: async () => ({ default: (await authzScreens.roles()).default as ComponentType }),
    host: AuthzHost,
    settingsLayout: true,
    permission: AUTHZ_MANAGE_PERMISSION,
  }),
  "pages/settings/role-bindings": uiPage({
    screen: async () => ({
      default: (await authzScreens.roleBindings()).default as ComponentType,
    }),
    host: AuthzHost,
    settingsLayout: true,
    permission: AUTHZ_MANAGE_PERMISSION,
  }),
};
