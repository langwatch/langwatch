/** Which page key the Data Retention address answers: `project:view`, framed by the settings layout, matching the platform page one for one. */

import { dataRetentionScreens } from "@langwatch/data-retention-web/screens/data-retention";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { DataRetentionHost } from "./data-retention-host";

/** The grant the platform page asked for, unchanged. */
const DATA_RETENTION_PAGE_PERMISSION = "project:view";

export const dataRetentionPageLoaders: UiPageLoaderRegistry = {
  "pages/settings/data-retention": uiPage({
    screen: async () => ({
      default: (await dataRetentionScreens.dataRetention()).default as ComponentType,
    }),
    host: DataRetentionHost,
    settingsLayout: true,
    permission: DATA_RETENTION_PAGE_PERMISSION,
  }),
};
