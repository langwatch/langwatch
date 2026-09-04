/**
 * Legacy online-evaluation edit form, in `@langwatch/evaluator-web`. NO API
 * binding of its own — reads go through the workflow family's already
 * installed client, to avoid a second tRPC client over the same cache keys.
 */

import { uiFeature } from "../../behavior/ui-feature";
import { evaluationPageLoaders } from "./ui/sections/evaluation-routes";

export const evaluationsFeature = uiFeature({
  name: "@langwatch/ui/features/evaluations",
  loaders: evaluationPageLoaders,
});
