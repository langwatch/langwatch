/**
 * Which page key the Integrations address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the same three wrappers in the same order as every
 * other settings family: the host outermost, the harvested settings chrome
 * inside it, and the platform page's own `organization:manage` grant innermost
 * — so a refusal is framed by the settings menu, exactly as
 * `withPermissionGuard({ layoutComponent: SettingsLayout })` framed its own.
 */

import { githubScreens } from "@langwatch/github-web/screens/integrations";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { INTEGRATIONS_PAGE_PERMISSION } from "../../behavior/github-host.adapter";
import { withGithubHost } from "./github-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const integrationsPage: UiPageLoader = async () => {
  const module = await githubScreens.integrations();
  const guarded = withUiPageGuard({
    permission: INTEGRATIONS_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  guarded.displayName = "IntegrationsPage";
  return { default: withGithubHost(withUiSettingsLayout(guarded)) };
};

export const githubPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/integrations": integrationsPage,
};
