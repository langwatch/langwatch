/**
 * The Workflows family, as this application composes it.
 *
 * The two screens, their dialogs and the chat panel live in
 * `@langwatch/workflow-web`; what belongs to the application is everything they
 * are not allowed to own — which page key each address answers, the permission
 * policy in front of the list, the transport their hooks run on, and the host
 * port that turns this application's capabilities into the questions the family
 * asks.
 */

import { workflowApi } from "@langwatch/workflow-web/screens/workflows";
import { lazyDrawer, type UiDrawerRegistry } from "@langwatch/ui-drawer";
import { uiFeatureApi, type UiFeatureApiBinding } from "../../behavior/ui-feature-transport";
import { workflowPageLoaders } from "./ui/sections/workflows-routes";

export const workflowApiBinding: UiFeatureApiBinding = uiFeatureApi({
  name: "@langwatch/workflow-web",
  api: workflowApi,
});

/**
 * The drawers mounted in the STUDIO host, by the name the address uses.
 *
 * EIGHT OF THEM AND NOT ONE IS THIS FAMILY'S COMPONENT: five are published by
 * `@langwatch/evaluator-web`, two by `@langwatch/dataset-web` and one by
 * `@langwatch/prompt-web`. What they share is the host they read — every one
 * came out of `platform/app` with the studio slice, already wired to
 * `@langwatch/workflow-web/studio-host/*` — and a drawer is mounted where its
 * host is. See `ui/sections/studio-host-drawers` for the whole argument.
 *
 * Lazy, like every page loader here, so seven editors and a CSV parser stay out
 * of the bundle until a reader opens one.
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
