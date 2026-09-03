/**
 * The Analytics family, as this application composes it.
 *
 * The eight screens, the chart renderer, the filter rail and the LangWatchQL
 * workbench live in `@langwatch/analytics-web`; what belongs to the application
 * is everything they are not allowed to own — which page keys the addresses
 * answer, which mode the builder's two keys mean, the permission policy in
 * front of them, the transport their hooks run on, and the host port that turns
 * this application's capabilities into the questions the family asks.
 */

import { analyticsApi } from "@langwatch/analytics-web/screens/analytics";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { analyticsPageLoaders } from "./ui/sections/analytics-routes";

export const analyticsApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/analytics-web",
  api: analyticsApi,
});

export { analyticsPageLoaders };
