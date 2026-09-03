/**
 * Which page key the SCIM address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN, and the same wrapping order as every other settings
 * family: the host outermost, the settings chrome inside it, and the platform
 * page's own `organization:manage` grant innermost. That grant is the
 * administrator's on purpose — a SCIM bearer token creates and deactivates
 * people in this organization.
 */

import { scimScreens } from "@langwatch/enterprise-scim-web/screens/scim";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { ScimHost } from "./scim-host";

/** The grant the platform page asked for, unchanged. */
export const SCIM_PAGE_PERMISSION = "organization:manage";

export const scimPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/scim": uiPage({
    screen: async () => ({ default: (await scimScreens.scim()).default as ComponentType }),
    host: ScimHost,
    settingsLayout: true,
    permission: SCIM_PAGE_PERMISSION,
  }),
};
