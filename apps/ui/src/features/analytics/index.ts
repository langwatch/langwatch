/** Analytics: eight screens, the chart renderer, the filter rail and the LangWatchQL workbench, all in `@langwatch/analytics-web`. */

import { analyticsApi } from "@langwatch/analytics-web/screens/analytics";
import { uiFeature } from "../../behavior/ui-feature";
import { analyticsPageLoaders } from "./ui/sections/analytics-routes";

export const analyticsFeature = uiFeature({
  name: "@langwatch/analytics-web",
  api: analyticsApi,
  loaders: analyticsPageLoaders,
});
