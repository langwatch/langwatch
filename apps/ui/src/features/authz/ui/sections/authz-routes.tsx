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
 * Each page is wrapped THREE times, and the order matters. The host provider is
 * OUTERMOST: a refusal renders the guard's own fallback, which asks nothing of
 * the AuthZ host, but a page that opens needs the host mounted above it before
 * its first render. Inside that, the SETTINGS CHROME — outside the guard,
 * because `withPermissionGuard({ layoutComponent })` wrapped its own refusal in
 * the layout, so a reader who lacks the grant still sees the settings frame
 * they navigated into. The guard is innermost, around the screen.
 *
 * BOTH KEYS CARRY A PAGE-LEVEL GRANT, and it is `organization:manage` for a
 * reason the platform recorded in a regression pin: five legacy administration
 * pages once guarded themselves on permissions a MEMBER inherits, and the roles
 * page was one of them, so a member session could read the full organization.
 * `platform/app/src/pages/settings/__tests__/admin-page-guards.unit.test.ts`
 * held that line by reading the page's source; the roles page is no longer
 * there to read, so the line is held here instead —
 * `apps/ui/tests/authz-page-policy.integration.test.tsx` mounts the refusal.
 */

import { AUTHZ_MANAGE_PERMISSION, authzScreens } from "@langwatch/authz-web/screens/authz";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { withAuthzHost } from "./authz-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const GUARD = withUiPageGuard({
  permission: AUTHZ_MANAGE_PERMISSION,
  fallbacks: FALLBACKS,
});

const rolesPage: UiPageLoader = async () => {
  const module = await authzScreens.roles();
  return { default: withAuthzHost(withUiSettingsLayout(GUARD(module.default as ComponentType))) };
};

const roleBindingsPage: UiPageLoader = async () => {
  const module = await authzScreens.roleBindings();
  return { default: withAuthzHost(withUiSettingsLayout(GUARD(module.default as ComponentType))) };
};

export const authzPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/roles": rolesPage,
  "pages/settings/role-bindings": roleBindingsPage,
};
