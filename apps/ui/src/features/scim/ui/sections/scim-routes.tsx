/**
 * Which page key the SCIM address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the same three wrappers in the same order as every
 * other settings family: the host outermost, the harvested settings chrome
 * inside it, and the platform page's own `organization:manage` grant innermost.
 * That grant is the administrator's on purpose — a SCIM bearer token creates and
 * deactivates people in this organization.
 */

import { scimScreens } from "@langwatch/enterprise-scim-web/screens/scim";
import type { ComponentType } from "react";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withUiSettingsLayout } from "../../../../ui/sections/ui-settings-layout";
import { SCIM_PAGE_PERMISSION } from "../../behavior/scim-host.adapter";
import { withScimHost } from "./scim-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const scimPage: UiPageLoader = async () => {
  const module = await scimScreens.scim();
  const guarded = withUiPageGuard({
    permission: SCIM_PAGE_PERMISSION,
    fallbacks: FALLBACKS,
  })(module.default as ComponentType);
  guarded.displayName = "ScimPage";
  return { default: withScimHost(withUiSettingsLayout(guarded)) };
};

export const scimPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/scim": scimPage,
};
