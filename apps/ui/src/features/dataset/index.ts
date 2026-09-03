/** Datasets: two screens, four overlays and the spreadsheet editor, all in `@langwatch/dataset-web`. */

import { datasetApi } from "@langwatch/dataset-web/screens/datasets";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { datasetPageLoaders } from "./ui/sections/dataset-routes";

export const datasetApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/dataset-web",
  api: datasetApi,
});

/** The drawers this family serves, by the name the address uses. */
export const datasetDrawers: UiDrawerRegistry = {
  selectDataset: lazyDrawer({
    factory: () => import("./ui/sections/dataset-drawers"),
    key: "SelectDatasetDrawer",
  }),
};

export { datasetPageLoaders };
