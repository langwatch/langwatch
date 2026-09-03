/**
 * The evaluator EDITOR drawers, as one public entry.
 *
 * SEPARATE FROM `drawers.ts` on purpose. That entry publishes the two overlays
 * the evaluators SCREEN owns — the history panel and the list — and those run on
 * this package's own `EvaluatorHostPort`. These three run on the STUDIO host:
 * they moved out of `platform/app` with the studio slice already reading
 * `@langwatch/workflow-web/studio-host/*` for the project, the transport, the
 * router and the toasts, and the composing application mounts a different host
 * over them. Two entries, because they are two different mounts.
 *
 * The drawers manifest recorded all three as unregisterable: they drove
 * `@langwatch/workflow-web/studio-host/use-drawer`, "a second copy of this same
 * model with its own module-scope stack", so registering them "would give the
 * application two drawer stacks that agree only on the URL". That file is a
 * re-export of `@langwatch/ui-drawer` now, so there is one stack and they open.
 *
 * TWO MORE JOINED THEM, for the same reason and off the same host. The Online
 * Evaluations screen and every monitor alert email address `onlineEvaluation`,
 * and the evaluator category selector addresses
 * `workflowSelectorForEvaluator`; both components read
 * `@langwatch/workflow-web/studio-host/*` exactly as the three above do, and
 * neither was exported, so both addresses opened nothing.
 */

export { CodeEvaluatorEditorDrawer } from "./evaluators/code-evaluator-editor-drawer";
export { EvaluatorCategorySelectorDrawer } from "./evaluators/evaluator-category-selector-drawer";
export { EvaluatorEditorDrawer } from "./evaluators/evaluator-editor-drawer";
export {
  OnlineEvaluationDrawer,
  type OnlineEvaluationDrawerProps,
} from "./evaluations/online-evaluation-drawer";
export {
  WorkflowSelectorForEvaluatorDrawer,
  type WorkflowSelectorForEvaluatorDrawerProps,
} from "../elements/evaluators/workflow-selector-for-evaluator-drawer";
