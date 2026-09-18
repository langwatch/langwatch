/**
 * What a browser installs when it installs evaluator: the drawers the address
 * bar opens (`?drawer.open=<name>`), under the names the product has always
 * used. Its screens join this declaration in the declarations fan-out.
 */

import { defineWebModule } from "@langwatch/ui-kernel";

export const evaluatorWeb = defineWebModule("evaluator")
  .withScreens({
    "pages/[project]/evaluators": {
      load: () => import("./ui/sections/evaluators.screen.tsx"),
    },
    "pages/[project]/evaluations/[id]/edit": {
      load: () => import("./ui/sections/evaluation-edit.screen.tsx"),
    },
  })
  .withDrawers({
    evaluatorList: {
      load: async () => ({
        default: (await import("./ui/sections/evaluator-list-drawer.tsx")).EvaluatorListDrawer,
      }),
    },
    evaluatorCategorySelector: {
      load: async () => ({
        default: (await import("./ui/sections/evaluators/evaluator-category-selector-drawer.tsx"))
          .EvaluatorCategorySelectorDrawer,
      }),
    },
    evaluatorEditor: {
      load: async () => ({
        default: (await import("./ui/sections/evaluators/evaluator-editor-drawer.tsx"))
          .EvaluatorEditorDrawer,
      }),
    },
    codeEvaluatorEditor: {
      load: async () => ({
        default: (await import("./ui/sections/evaluators/code-evaluator-editor-drawer.tsx"))
          .CodeEvaluatorEditorDrawer,
      }),
    },
    workflowSelectorForEvaluator: {
      load: async () => ({
        default: (
          await import("./ui/elements/evaluators/workflow-selector-for-evaluator-drawer.tsx")
        ).WorkflowSelectorForEvaluatorDrawer,
      }),
    },
    onlineEvaluation: {
      load: async () => ({
        default: (await import("./ui/sections/evaluations/online-evaluation-drawer.tsx"))
          .OnlineEvaluationDrawer,
      }),
    },
    guardrails: {
      load: async () => ({
        default: (await import("./ui/elements/evaluations/guardrails-drawer.tsx")).GuardrailsDrawer,
      }),
    },
  });
