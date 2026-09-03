/**
 * Which page key the Data Privacy address answers: host outermost, settings
 * chrome inside it, `project:view` grant innermost — same order as its
 * sibling, so a refusal is framed by the settings menu.
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
