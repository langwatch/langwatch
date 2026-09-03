/**
 * Legacy online-evaluation edit form, in `@langwatch/evaluator-web`. NO API
 * binding of its own — reads go through the workflow family's already
 * installed client, to avoid a second tRPC client over the same cache keys.
 */

import { evaluationPageLoaders } from "./ui/sections/evaluation-routes";

export { evaluationPageLoaders };
