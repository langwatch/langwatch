/**
 * The URL-addressed drawers this family owns.
 *
 * ONE PUBLIC ENTRY FOR THE WHOLE SET, the shape `./screens/evaluators` keeps
 * for the pages: the composing application spreads a map of these into its
 * drawer registry, so what it may name is one entry rather than a path per
 * component. Each is a plain component — it takes what the address carries and
 * an `onClose` — and knows nothing about the registry, the stack or the query
 * key that opened it.
 *
 * `guardrails` IS HERE AND NOT IN `editor-drawers.ts`, because the split
 * between the two entries is which host a drawer reads and this one reads
 * none: it renders an evaluator picker and a code snippet, and the only thing
 * it asks the framework for is the drawer stack. `@langwatch/monitor-web`'s
 * Online Evaluations screen writes its address; the composing application
 * mounts it beside this family's own two.
 */

export { EvaluatorHistoryPanel } from "./evaluator-history-panel";
export {
  GuardrailsDrawer,
  type GuardrailsDrawerProps,
} from "../elements/evaluations/guardrails-drawer";
export { EvaluatorListDrawer, type EvaluatorListDrawerProps } from "./evaluator-list-drawer";
