/** Annotations: screen, two overlays, the sidebar and the list, all in `@langwatch/annotation-web`. */

import { annotationApi } from "@langwatch/annotation-web/screens/annotations";
import { uiFeature } from "../../behavior/ui-feature";
import { annotationPageLoaders } from "./ui/sections/annotation-routes";

export const annotationFeature = uiFeature({
  name: "@langwatch/annotation-web",
  api: annotationApi,
  loaders: annotationPageLoaders,
});
