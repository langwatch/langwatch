/**
 * The six drawers that run on the STUDIO host, mounted in it.
 *
 * WHY THEY ARE TOGETHER AND WHY THEY ARE HERE. The drawers manifest recorded
 * these six — `promptEditor`, `evaluatorEditor`, `evaluatorCategorySelector`,
 * `codeEvaluatorEditor`, `addOrEditDataset` and `uploadCSV` — as the ones that
 * had already travelled into their packages and still could not be registered:
 * every one of them drives `@langwatch/workflow-web/studio-host/use-drawer`,
 * which was a SECOND copy of the URL-routed drawer model with its own
 * module-scope stack, "reached through a router shim that throws without a
 * WorkflowHostProvider". Registering them then would have given the application
 * two drawer stacks that agree only on the URL, and thrown on mount.
 *
 * Both halves of that are answered. `studio-host/use-drawer` is a re-export of
 * `@langwatch/ui-drawer` now, so there is one stack; and this file supplies the
 * `WorkflowHostProvider` they need, once, behind the registry's lazy import.
 *
 * THEY LIVE UNDER THE WORKFLOWS FEATURE RATHER THAN UNDER THEIR OWN, and that
 * is deliberate rather than tidy. "A feature owns its drawers" decides who
 * publishes the component; what decides where it is MOUNTED is which host it
 * reads, and all six read this one. Three are the evaluator family's, two the
 * dataset family's and one the prompt family's — each still published by its own
 * package, each still opened by its own address. The day a family gives its
 * editor a port of its own, its entry moves to its own feature and nothing else
 * changes.
 */

import { AddOrEditDatasetDrawer as AddOrEditDataset } from "@langwatch/dataset-web/components/AddOrEditDatasetDrawer";
import { UploadCSVDrawer as UploadCSV } from "@langwatch/dataset-web/components/datasets/UploadCSVDrawer";
import {
  CodeEvaluatorEditorDrawer as CodeEvaluatorEditor,
  EvaluatorCategorySelectorDrawer as EvaluatorCategorySelector,
  EvaluatorEditorDrawer as EvaluatorEditor,
  OnlineEvaluationDrawer as OnlineEvaluation,
  WorkflowSelectorForEvaluatorDrawer as WorkflowSelectorForEvaluator,
} from "@langwatch/evaluator-web/editor-drawers";
import { PromptEditorDrawer as PromptEditor } from "@langwatch/prompt-web/components/prompts/PromptEditorDrawer";

import { withWorkflowHost } from "./workflows-host-provider";

export const AddOrEditDatasetDrawer = withWorkflowHost(AddOrEditDataset);
export const UploadCSVDrawer = withWorkflowHost(UploadCSV);
export const CodeEvaluatorEditorDrawer = withWorkflowHost(CodeEvaluatorEditor);
export const EvaluatorCategorySelectorDrawer = withWorkflowHost(EvaluatorCategorySelector);
export const EvaluatorEditorDrawer = withWorkflowHost(EvaluatorEditor);
export const PromptEditorDrawer = withWorkflowHost(PromptEditor);

/**
 * The two that joined them, off the same host and for the same reason.
 *
 * `onlineEvaluation` is the widest of the eight: the Online Evaluations screen
 * opens it, a trace's evaluation row opens it with the monitor it failed on,
 * Langy's capability registry names it, and EVERY MONITOR ALERT EMAIL carries
 * `?drawer.open=onlineEvaluation&drawer.monitorId=<id>` out of the product.
 * `workflowSelectorForEvaluator` is what the evaluator category selector hands
 * over to when a reader chooses to write their own evaluator as a workflow.
 * Both read `@langwatch/workflow-web/studio-host/*` for the project, the
 * transport and the router, so both are mounted in the host the six above are.
 */
export const OnlineEvaluationDrawer = withWorkflowHost(OnlineEvaluation);
export const WorkflowSelectorForEvaluatorDrawer = withWorkflowHost(WorkflowSelectorForEvaluator);
