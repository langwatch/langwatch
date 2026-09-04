/** Online Evaluations: screen, table, performance preview and replicate dialog, all in `@langwatch/monitor-web`. */

import { monitorApi } from "@langwatch/monitor-web/screens/online-evaluations";
import { uiFeature } from "../../behavior/ui-feature";
import { monitorPageLoaders } from "./ui/sections/monitor-routes";

export const monitorFeature = uiFeature({
  name: "@langwatch/monitor-web",
  api: monitorApi,
  loaders: monitorPageLoaders,
});
