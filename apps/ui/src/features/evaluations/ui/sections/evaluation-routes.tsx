/**
 * Which page keys the legacy online-evaluation edit form answers: both
 * resolve one module, one host — the workflow host, since `CheckConfigForm`
 * already reads `@langwatch/workflow-web/studio-host/*`.
 */

import { evaluationEditScreens } from "@langwatch/evaluator-web/screens/evaluation-edit";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { WorkflowHost } from "../../../workflows/ui/sections/workflows-host";

// No guard: the platform `edit.tsx` was wrapped in nothing, and
// `monitors.getById` refuses a reader who may not see the monitor.
const evaluationEditPage = uiPage({
  screen: evaluationEditScreens.evaluationEdit,
  host: WorkflowHost,
});

export const evaluationPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/evaluations/[id]/edit": evaluationEditPage,
  "pages/[project]/evaluations/[id]/edit/choose": evaluationEditPage,
};
