/**
 * What a browser installs when it installs evaluator: the drawers the address
 * bar opens (`?drawer.open=<name>`), under the names the product has always
 * used. Its screens join this declaration in the declarations fan-out.
 */

import { defineBrowserModule } from "@langwatch/browser";
import { EvaluatorSettingsFormToken, evaluatorTrpc } from "@langwatch/evaluator-contract";

import { evaluatorApi } from "./behavior/evaluator-api.ts";

export const evaluatorWeb = defineBrowserModule("evaluator")
  .withApi(evaluatorApi, { contracts: [evaluatorTrpc] })
  .withHosts({
    requires: ["EvaluatorHostApi"],
    mounts: { EvaluatorHostApi: { load: () => import("./behavior/evaluator-host-mount.tsx") } },
  })
  .withScreens({
    "pages/[project]/evaluators": {
      requires: "evaluations:view",
      load: () => import("./ui/sections/evaluators.screen.tsx"),
    },
    "pages/[project]/evaluations/[id]/edit": {
      load: () => import("./ui/sections/evaluation-edit.screen.tsx"),
    },
    "pages/[project]/evaluations/[id]/edit/choose": {
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
          await import("./ui/sections/evaluators/workflow-selector-for-evaluator-drawer.tsx")
        ).WorkflowSelectorForEvaluatorDrawer,
      }),
    },
    evaluatorHistory: {
      load: async () => ({
        default: (await import("./ui/sections/evaluator-history-panel.tsx")).EvaluatorHistoryPanel,
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
        default: (await import("./ui/sections/evaluations/guardrails-drawer.tsx")).GuardrailsDrawer,
      }),
    },
  })
  /** The studio's evaluator editor and inline settings form (§3.4 rule 7). */
  .withCapabilities({
    studioEvaluatorEditor: {
      load: async () => ({
        default: (await import("./ui/sections/evaluators/lent-studio-evaluator.tsx"))
          .LentStudioEvaluatorEditor,
      }),
    },
  })
  .lends(EvaluatorSettingsFormToken, {
    load: async () => ({
      default: (await import("./ui/sections/evaluators/lent-studio-evaluator.tsx"))
        .LentEvaluatorSettingsForm,
    }),
  });
