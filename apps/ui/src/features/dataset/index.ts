/**
 * The Datasets family, as this application composes it.
 *
 * The two screens, their four overlays and the spreadsheet editor live in
 * `@langwatch/dataset-web`; what belongs to the application is everything they
 * are not allowed to own — which page keys the addresses answer, the permission
 * policy in front of them, the transport their hooks run on, and the host port
 * that turns this application's capabilities into the questions the family asks.
 */

import { datasetApi } from "@langwatch/dataset-web/screens/datasets";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { datasetPageLoaders } from "./ui/sections/dataset-routes";

export const datasetApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/dataset-web",
  api: datasetApi,
});

export { datasetPageLoaders };
