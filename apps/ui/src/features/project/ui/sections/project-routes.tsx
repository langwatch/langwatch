/**
 * Which page key the general Settings address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the same three wrappers in the same order as every
 * other settings family: the host outermost, the harvested settings chrome
 * inside it, and the platform page's own `organization:view` grant innermost.
 *
 * THE GRANT IS THE MEMBER'S, not the administrator's, and that is deliberate:
 * every member may READ their organization's settings, and each control on the
 * page is separately disabled for a reader who may not change it. Hiding the
 * page would tell a member nothing about what their organization is configured
 * to do.
 */

import { projectScreens } from "@langwatch/project-web/screens/project";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { PROJECT_SETTINGS_PAGE_PERMISSION } from "../../behavior/project-host.adapter";
import { withProjectHost } from "./project-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const projectSettingsPage: UiPageLoader = async () => {
  const module = await projectScreens.projectSettings();
  const guarded = withUiPageGuard({
    permission: PROJECT_SETTINGS_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  guarded.displayName = "ProjectSettingsPage";
  return { default: withProjectHost(withUiSettingsLayout(guarded)) };
};

export const projectPageLoaders: UiPageLoaderRegistry = {
  "pages/settings": projectSettingsPage,
};
