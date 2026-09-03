/**
 * Eight drawers whose editors call `@langwatch/ui-host/use-drawer`, so each
 * needs a `WorkflowHostProvider` — published by its own feature, mounted here.
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

import { withWorkflowHost } from "./workflows-host";

export const AddOrEditDatasetDrawer = withWorkflowHost(AddOrEditDataset);
export const UploadCSVDrawer = withWorkflowHost(UploadCSV);
export const CodeEvaluatorEditorDrawer = withWorkflowHost(CodeEvaluatorEditor);
export const EvaluatorCategorySelectorDrawer = withWorkflowHost(EvaluatorCategorySelector);
export const EvaluatorEditorDrawer = withWorkflowHost(EvaluatorEditor);
export const PromptEditorDrawer = withWorkflowHost(PromptEditor);

/**
 * `onlineEvaluation` (Online Evaluations, trace rows, Langy, monitor alert
 * emails) and `workflowSelectorForEvaluator` — same host as the six above.
 */
export const OnlineEvaluationDrawer = withWorkflowHost(OnlineEvaluation);
export const WorkflowSelectorForEvaluatorDrawer = withWorkflowHost(WorkflowSelectorForEvaluator);
