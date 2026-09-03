/** Which page key the SCIM address answers: `organization:manage`, the administrator's grant, since a SCIM token creates and deactivates people. */

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
