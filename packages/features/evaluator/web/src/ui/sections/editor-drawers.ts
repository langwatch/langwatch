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
 */

export { CodeEvaluatorEditorDrawer } from "../../components/evaluators/CodeEvaluatorEditorDrawer";
export { EvaluatorCategorySelectorDrawer } from "../../components/evaluators/EvaluatorCategorySelectorDrawer";
export { EvaluatorEditorDrawer } from "../../components/evaluators/EvaluatorEditorDrawer";
