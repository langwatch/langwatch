/**
 * Which page keys the RBAC settings addresses answer, and what they are
 * wrapped in.
 *
 * TWO KEYS, TWO SCREENS. The keys still read `pages/settings/roles` and
 * `pages/settings/role-bindings`, and they are kept rather than renamed: the
 * route transcript in `apps/ui/tests` is the parity bar for the URL surface and
 * fails the moment a page key changes, so renaming one would spend that guard's
 * signal on a cosmetic edit.
 *
 * BOTH KEYS CARRY A PAGE-LEVEL GRANT, and it is `organization:manage` for a
 * reason the platform recorded in a regression pin: five legacy administration
 * pages once guarded themselves on permissions a MEMBER inherits, and the roles
 * page was one of them, so a member session could read the full organization.
 * `apps/ui/tests/authz-page-policy.integration.test.tsx` mounts the refusal.
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
