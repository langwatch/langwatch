/**
 * Which page keys the legacy online-evaluation edit form answers.
 *
 * TWO KEYS, ONE SCREEN, exactly as `platform/app` registered them: the
 * `.../edit/choose` address predates the drawer that superseded this form and
 * has always resolved the same module, which is why both keys name one loader
 * and the screen never reads which of the two it was opened at.
 *
 * THE HOST IS THE WORKFLOW HOST. `CheckConfigForm` and its whole closure moved
 * into `@langwatch/evaluator-web` with the studio slice, already reading
 * `@langwatch/workflow-web/studio-host/*` for the project, the transport, the
 * router and the toasts; a port of this family's own would answer none of them.
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
