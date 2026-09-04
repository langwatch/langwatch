/** Datasets: two screens, four overlays and the spreadsheet editor, all in `@langwatch/dataset-web`. */

import { datasetApi } from "@langwatch/dataset-web/screens/datasets";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { datasetPageLoaders } from "./ui/sections/dataset-routes";

export const datasetFeature = uiFeature({
  name: "@langwatch/dataset-web",
  api: datasetApi,
  loaders: datasetPageLoaders,
  /** The drawers this family serves, by the name the address uses. */
  drawers: {
    selectDataset: lazyDrawer({
      factory: () => import("./ui/sections/dataset-drawers"),
      key: "SelectDatasetDrawer",
    }),
  },
});
