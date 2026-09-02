/**
 * The Online Evaluations family, as this application composes it.
 *
 * The screen, its table, the performance preview and the replicate dialog live
 * in `@langwatch/monitor-web`; what belongs to the application is everything
 * they are not allowed to own — which page key the address answers, the
 * permission policy in front of it, the transport its hooks run on, and the
 * host port that turns this application's capabilities into the questions the
 * family asks.
 */

import { monitorApi } from "@langwatch/monitor-web/screens/online-evaluations";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { monitorPageLoaders } from "./ui/sections/monitor-routes";

export const monitorApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/monitor-web",
  api: monitorApi,
});

export { monitorPageLoaders };
