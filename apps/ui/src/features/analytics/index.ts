/** Analytics: eight screens, the chart renderer, the filter rail and the LangWatchQL workbench, all in `@langwatch/analytics-web`. */

import { analyticsApi } from "@langwatch/analytics-web/screens/analytics";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { analyticsPageLoaders } from "./ui/sections/analytics-routes";

export const analyticsApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/analytics-web",
  api: analyticsApi,
});

export { analyticsPageLoaders };
