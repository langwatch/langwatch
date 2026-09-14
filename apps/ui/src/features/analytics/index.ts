/** Analytics feature: screens, chart renderer, filter rail, and LangWatchQL workbench. */

import { analyticsApi } from "@langwatch/analytics-web/analytics";
import { uiFeature } from "../../behavior/ui-feature";
import { analyticsPageLoaders } from "./ui/sections/analytics-routes";

export const analyticsFeature = uiFeature({
  name: "@langwatch/analytics-web",
  api: analyticsApi,
  loaders: analyticsPageLoaders,
});
