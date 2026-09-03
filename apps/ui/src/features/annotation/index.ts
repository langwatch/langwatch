/** Annotations: screen, two overlays, the sidebar and the list, all in `@langwatch/annotation-web`. */

import { annotationApi } from "@langwatch/annotation-web/screens/annotations";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { annotationPageLoaders } from "./ui/sections/annotation-routes";

export const annotationApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/annotation-web",
  api: annotationApi,
});

export { annotationPageLoaders };
