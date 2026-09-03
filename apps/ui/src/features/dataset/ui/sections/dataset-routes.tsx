/**
 * Which page keys the Datasets addresses answer, and what they are wrapped in.
 *
 * TWO KEYS, TWO SCREENS. The keys still read `pages/[project]/datasets` and
 * `pages/[project]/datasets/[id]`, and they are kept rather than renamed: the
 * route transcript in `apps/ui/tests/fixtures` is the parity bar for the URL
 * surface and fails the moment a page key changes, so renaming one would spend
 * that guard's signal on a cosmetic edit.
 *
 * THE POLICY IS THE PLATFORM PAGES', ONE FOR ONE, AND THEY DIFFER FROM EACH
 * OTHER: the list page was wrapped in `withPermissionGuard("datasets:view")`,
 * and the detail page was NOT wrapped at all — it read `hasPermission` only to
 * decide whether to offer the Run experiment button. So the list key carries the
 * grant and the detail key carries none, which is the behaviour a reader with a
 * deep link into one dataset has today.
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
