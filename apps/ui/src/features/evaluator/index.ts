/**
 * The Evaluators family, as this application composes it.
 *
 * The screen, its dialogs, the history panel and the API usage snippets live in
 * `@langwatch/evaluator-web`; what belongs to the application is everything they
 * are not allowed to own — which page key the address answers, the permission
 * policy in front of it, the transport its hooks run on, and the host port that
 * turns this application's capabilities into the questions the family asks.
 */

import { evaluatorApi } from "@langwatch/evaluator-web/screens/evaluators";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { evaluatorPageLoaders } from "./ui/sections/evaluator-routes";

export const evaluatorApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/evaluator-web",
  api: evaluatorApi,
});

export { evaluatorPageLoaders };
