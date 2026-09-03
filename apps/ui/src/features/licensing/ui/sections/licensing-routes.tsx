/**
 * Which page key the License address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the host outermost with the harvested settings
 * chrome inside it. THERE IS NO GUARD, one for one with the platform page: this
 * was the only settings page wrapped in no `withPermissionGuard` at all, and
 * inventing one would be a change to who can reach an address that a page move
 * does not own. Every procedure behind it states its own policy.
 */

import { licensingScreens } from "@langwatch/enterprise-licensing-web/screens/license";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { withLicensingHost } from "./licensing-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const licensePage: UiPageLoader = async () => {
  const module = await licensingScreens.license();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default as ComponentType);
  guarded.displayName = "LicensePage";
  return { default: withLicensingHost(withUiSettingsLayout(guarded)) };
};

export const licensingPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/license": licensePage,
};
