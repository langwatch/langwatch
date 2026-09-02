/**
 * The Topic Clustering family, as this application composes it.
 *
 * The screen lives in `@langwatch/topic-web`; what belongs to the application
 * is everything it is not allowed to own — the page key, the permission policy,
 * the settings chrome, the transport, and the host port that turns this
 * application's capabilities into the questions the screen asks.
 */

import { topicApi } from "@langwatch/topic-web/screens/topic-clustering";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { topicPageLoaders } from "./ui/sections/topic-routes";

export const topicApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/topic-web",
  api: topicApi,
});

export { topicPageLoaders };
