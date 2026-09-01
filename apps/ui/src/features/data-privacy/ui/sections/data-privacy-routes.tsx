/**
 * Which page key the Data Privacy address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the same three wrappers in the same order as its
 * sibling: the host outermost, the harvested settings chrome inside it, and the
 * platform page's own `project:view` grant innermost — so a refusal is framed
 * by the settings menu, exactly as `withPermissionGuard({ layoutComponent })`
 * framed its own.
 */

import { dataPrivacyScreens } from "@langwatch/data-privacy-web/screens/data-privacy";
import type { ComponentType } from "react";
import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { DATA_PRIVACY_PAGE_PERMISSION } from "../../behavior/data-privacy-host.adapter";
import { withDataPrivacyHost } from "./data-privacy-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const dataPrivacyPage: UiPageLoader = async () => {
  const module = await dataPrivacyScreens.dataPrivacy();
  const guarded = withUiPageGuard({
    permission: DATA_PRIVACY_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  return { default: withDataPrivacyHost(withUiSettingsLayout(guarded)) };
};

export const dataPrivacyPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/data-privacy": dataPrivacyPage,
};
