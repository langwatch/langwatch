/**
 * Which page key the Audit Log address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The key still reads `pages/settings/audit-log`, kept
 * rather than renamed: the route transcript in `apps/ui/tests` is the parity bar
 * for the URL surface and fails the moment a page key changes, so renaming one
 * would spend that guard's signal on a cosmetic edit.
 *
 * Wrapped three times, and the order matters. The host provider is OUTERMOST: a
 * refusal renders the guard's own fallback, which asks nothing of the
 * organization host, but a page that opens needs the host mounted above it
 * before its first render. Inside that, the SETTINGS CHROME — outside the
 * guard, because `withPermissionGuard({ layoutComponent })` wrapped its own
 * refusal in the layout, so a reader who lacks the grant still sees the settings
 * frame they navigated into. The guard is innermost, around the screen.
 *
 * THE KEY CARRIES `organization:manage`, one for one with the platform page.
 * The PLAN gate is not a second guard and deliberately not one: a reader below
 * Enterprise gets the page and a straight answer about what the audit trail
 * would show, because hiding a paid capability makes it look missing rather
 * than purchasable.
 */

import { organizationScreens } from "@langwatch/organization-web/screens/organization";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { AUDIT_LOG_PAGE_PERMISSION } from "../../behavior/organization-host.adapter";
import { withOrganizationHost } from "./organization-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const auditLogPage: UiPageLoader = async () => {
  const module = await organizationScreens.auditLog();
  const guarded = withUiPageGuard({
    permission: AUDIT_LOG_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  return { default: withOrganizationHost(withUiSettingsLayout(guarded)) };
};

export const organizationPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/audit-log": auditLogPage,
};
