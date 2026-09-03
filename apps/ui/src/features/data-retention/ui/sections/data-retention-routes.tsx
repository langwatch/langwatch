/**
 * Which page key the Data Retention address answers, and what it is wrapped in.
 *
 * ONE KEY, ONE SCREEN. The key still reads `pages/settings/data-retention`, and
 * it is kept rather than renamed: the route transcript in `apps/ui/tests`
 * is the parity bar for the URL surface and fails the moment a page key
 * changes, so renaming one would spend that guard's signal on a cosmetic edit.
 *
 * THE POLICY IS THE PLATFORM PAGE'S, ONE FOR ONE: `withPermissionGuard`
 * ("project:view") and no flag, framed by the settings layout.
 */

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
