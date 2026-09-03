/**
 * The legacy online-evaluation edit form, as this application composes it.
 *
 * The screen and every field on it live in `@langwatch/evaluator-web`; what
 * belongs to the application is which page keys the two addresses answer and
 * which host is mounted above them.
 *
 * NO API BINDING OF ITS OWN: every read is `monitors.*` through
 * `@langwatch/workflow-web/studio-host/api`, the workflow family's client,
 * which is already installed. A second binding over the same procedures would
 * be a second tRPC client on the same cache keys.
 */

import { evaluationPageLoaders } from "./ui/sections/evaluation-routes";

export { evaluationPageLoaders };
