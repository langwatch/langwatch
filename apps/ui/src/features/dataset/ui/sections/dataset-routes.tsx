/**
 * Which page keys the Datasets addresses answer. The two differ on purpose:
 * the list guards on `datasets:view`, the detail page carries no grant — a
 * deep link into one dataset works, matching the platform pages.
 */

import { datasetScreens } from "@langwatch/dataset-web/screens/datasets";
import type { ComponentType } from "react";
import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { DatasetHost } from "./dataset-host";

export const datasetPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/datasets": uiPage({
    screen: async () => ({ default: (await datasetScreens.datasets()).default as ComponentType }),
    host: DatasetHost,
    permission: "datasets:view",
  }),
  "pages/[project]/datasets/[id]": uiPage({
    screen: async () => ({
      default: (await datasetScreens.datasetEditor()).default as ComponentType,
    }),
    host: DatasetHost,
  }),
};
