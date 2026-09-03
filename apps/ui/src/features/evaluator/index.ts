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
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { evaluatorPageLoaders } from "./ui/sections/evaluator-routes";

export const evaluatorApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/evaluator-web",
  api: evaluatorApi,
});

/**
 * The drawers this family serves, by the name the address uses.
 *
 * Lazy, like every page loader here, so the family's adapter and its package's
 * presentation stay out of the bundle until a reader opens one.
 */
export const evaluatorDrawers: UiDrawerRegistry = {
  evaluatorHistory: lazyDrawer({
    factory: () => import("./ui/sections/evaluator-drawers"),
    key: "EvaluatorHistoryDrawer",
  }),
  evaluatorList: lazyDrawer({
    factory: () => import("./ui/sections/evaluator-drawers"),
    key: "EvaluatorListDrawer",
  }),
  /**
   * The one drawer here that reads no host, so it is registered as the package
   * publishes it rather than through `evaluator-drawers`.
   *
   * `guardrails` renders an evaluator picker and the code a customer pastes to
   * call that evaluator as a guardrail; the only thing it asks the framework
   * for is the drawer stack, since picking an evaluator navigates to
   * `evaluatorList` and comes back with the choice. `@langwatch/monitor-web`'s
   * Online Evaluations screen writes the address and nothing opened, because
   * the component was never exported.
   */
  guardrails: lazyDrawer({
    factory: () => import("@langwatch/evaluator-web/drawers"),
    key: "GuardrailsDrawer",
  }),
};

export { evaluatorPageLoaders };
