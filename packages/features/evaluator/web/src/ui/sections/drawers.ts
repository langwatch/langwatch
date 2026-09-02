/**
 * The URL-addressed drawers this family owns.
 *
 * ONE PUBLIC ENTRY FOR THE WHOLE SET, the shape `./screens/evaluators` keeps
 * for the pages: the composing application spreads a map of these into its
 * drawer registry, so what it may name is one entry rather than a path per
 * component. Each is a plain component — it takes what the address carries and
 * an `onClose` — and knows nothing about the registry, the stack or the query
 * key that opened it.
 */

export { EvaluatorHistoryPanel } from "./evaluator-history-panel";
export {
  EvaluatorListDrawer,
  type EvaluatorListDrawerProps,
} from "./evaluator-list-drawer";
