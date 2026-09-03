/** Online Evaluations: screen, table, performance preview and replicate dialog, all in `@langwatch/monitor-web`. */

import { monitorApi } from "@langwatch/monitor-web/screens/online-evaluations";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { monitorPageLoaders } from "./ui/sections/monitor-routes";

export const monitorApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/monitor-web",
  api: monitorApi,
});

export { monitorPageLoaders };
