/** Evaluators: screen, dialogs, history panel and API usage snippets, all in `@langwatch/evaluator-web`. */

import { evaluatorApi } from "@langwatch/evaluator-web/screens/evaluators";
import { lazyDrawer } from "@langwatch/ui-drawer";
import { uiFeature } from "../../behavior/ui-feature";
import { evaluatorPageLoaders } from "./ui/sections/evaluator-routes";

export const evaluatorFeature = uiFeature({
  name: "@langwatch/evaluator-web",
  api: evaluatorApi,
  loaders: evaluatorPageLoaders,
  /** The drawers this family serves, by the name the address uses — lazy, so their presentation stays out of the bundle until opened. */
  drawers: {
    evaluatorHistory: lazyDrawer({
      factory: () => import("./ui/sections/evaluator-drawers"),
      key: "EvaluatorHistoryDrawer",
    }),
    evaluatorList: lazyDrawer({
      factory: () => import("./ui/sections/evaluator-drawers"),
      key: "EvaluatorListDrawer",
    }),
    /**
     * `guardrails` reads no host, so it registers straight off the package
     * rather than through `evaluator-drawers`. It asks the framework only for
     * the drawer stack — picking an evaluator navigates to `evaluatorList`.
     */
    guardrails: lazyDrawer({
      factory: () => import("@langwatch/evaluator-web/drawers"),
      key: "GuardrailsDrawer",
    }),
  },
});
