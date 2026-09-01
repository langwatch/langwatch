/**
 * Which page key the Data Retention address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The key still reads `pages/settings/data-retention`, and
 * it is kept rather than renamed: the route transcript in `apps/ui/tests`
 * is the parity bar for the URL surface and fails the moment a page key
 * changes, so renaming one would spend that guard's signal on a cosmetic edit.
 *
 * The page is wrapped THREE times, and the order matters. The host provider is
 * OUTERMOST: a refusal renders the guard's own fallback, which asks nothing of
 * the Data Retention host, but a page that opens needs the host mounted above
 * it before its first render. Inside that, the SETTINGS CHROME — outside the
 * guard, because `withPermissionGuard({ layoutComponent })` wrapped its own
 * refusal in the layout, so a reader who lacks the grant still sees the
 * settings frame they navigated into rather than a bare notice. The guard is
 * innermost, around the screen.
 *
 * THE POLICY IS THE PLATFORM PAGE'S, ONE FOR ONE: `withPermissionGuard`
 * ("project:view") and no flag. `layoutComponent: SettingsLayout` was the other
 * half of that call, and it is the one thing this family DOES carry over rather
 * than drop — `apps/ui`'s harvested copy stands in for it, in the same
 * position.
 *
 * The wrapping happens once per lazy load rather than once per render: React
 * Router caches what a `lazy` resolves to, so the component identity below is
 * stable for the life of the route.
 */

import { dataRetentionScreens } from "@langwatch/data-retention-web/screens/data-retention";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { DATA_RETENTION_PAGE_PERMISSION } from "../../behavior/data-retention-host.adapter";
import { withDataRetentionHost } from "./data-retention-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const dataRetentionPage: UiPageLoader = async () => {
  const module = await dataRetentionScreens.dataRetention();
  const guarded = withUiPageGuard({
    permission: DATA_RETENTION_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  return { default: withDataRetentionHost(withUiSettingsLayout(guarded)) };
};

export const dataRetentionPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/data-retention": dataRetentionPage,
};
