/** Workflows: two screens, their dialogs and the chat panel, all in `@langwatch/workflow-web`. */

import { workflowApi } from "@langwatch/workflow-web/screens/workflows";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { workflowPageLoaders } from "./ui/sections/workflows-routes";

export const workflowApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/workflow-web",
  api: workflowApi,
});

/**
 * Eight drawers mounted in the STUDIO host, none this family's own —
 * five from `@langwatch/evaluator-web`, two from `@langwatch/dataset-web`,
 * one from `@langwatch/prompt-web` (`studio-host-drawers.tsx`).
 */
export const workflowDrawers: UiDrawerRegistry = {
  addOrEditDataset: lazyDrawer({
    factory: () => import("./ui/sections/studio-host-drawers"),
    key: "AddOrEditDatasetDrawer",
  }),
  uploadCSV: lazyDrawer({
    factory: () => import("./ui/sections/studio-host-drawers"),
    key: "UploadCSVDrawer",
  }),
  codeEvaluatorEditor: lazyDrawer({
    factory: () => import("./ui/sections/studio-host-drawers"),
    key: "CodeEvaluatorEditorDrawer",
  }),
  evaluatorCategorySelector: lazyDrawer({
    factory: () => import("./ui/sections/studio-host-drawers"),
    key: "EvaluatorCategorySelectorDrawer",
  }),
  evaluatorEditor: lazyDrawer({
    factory: () => import("./ui/sections/studio-host-drawers"),
    key: "EvaluatorEditorDrawer",
  }),
  promptEditor: lazyDrawer({
    factory: () => import("./ui/sections/studio-host-drawers"),
    key: "PromptEditorDrawer",
  }),
  onlineEvaluation: lazyDrawer({
    factory: () => import("./ui/sections/studio-host-drawers"),
    key: "OnlineEvaluationDrawer",
  }),
  workflowSelectorForEvaluator: lazyDrawer({
    factory: () => import("./ui/sections/studio-host-drawers"),
    key: "WorkflowSelectorForEvaluatorDrawer",
  }),
};

export { workflowPageLoaders };
