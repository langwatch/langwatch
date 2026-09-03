/** Topic Clustering: single screen in `@langwatch/topic-web`. */

import { topicApi } from "@langwatch/topic-web/screens/topic-clustering";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { topicPageLoaders } from "./ui/sections/topic-routes";

export const topicApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/topic-web",
  api: topicApi,
});

export { topicPageLoaders };
