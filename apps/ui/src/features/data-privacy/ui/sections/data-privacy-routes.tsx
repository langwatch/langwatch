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
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { DataPrivacyHost } from "./data-privacy-host";

/** The grant the platform page asked for, unchanged. */
const DATA_PRIVACY_PAGE_PERMISSION = "project:view";

export const dataPrivacyPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/data-privacy": uiPage({
    screen: async () => ({
      default: (await dataPrivacyScreens.dataPrivacy()).default as ComponentType,
    }),
    host: DataPrivacyHost,
    settingsLayout: true,
    permission: DATA_PRIVACY_PAGE_PERMISSION,
  }),
};
