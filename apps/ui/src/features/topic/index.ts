/** Topic Clustering: single screen in `@langwatch/topic-web`. */

import { topicApi } from "@langwatch/topic-web/screens/topic-clustering";
import { uiFeature } from "../../behavior/ui-feature";
import { topicPageLoaders } from "./ui/sections/topic-routes";

export const topicFeature = uiFeature({
  name: "@langwatch/topic-web",
  api: topicApi,
  loaders: topicPageLoaders,
});
