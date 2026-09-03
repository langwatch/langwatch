/**
 * Which page keys the legacy online-evaluation edit form answers.
 *
 * TWO KEYS, ONE SCREEN, exactly as `platform/app` registered them: the
 * `.../edit/choose` address predates the drawer that superseded this form and
 * has always resolved the same module, which is why both keys name one loader
 * and the screen never reads which of the two it was opened at.
 *
 * NO GUARD, and that is the platform page's own policy: `edit.tsx` was wrapped
 * in nothing, and `monitors.getById` refuses a reader who may not see the
 * monitor. Inventing a guard is a change to who can reach a page, which a page
 * move does not own.
 *
 * THE HOST IS THE WORKFLOW HOST. `CheckConfigForm` and its whole closure moved
 * into `@langwatch/evaluator-web` with the studio slice, already reading
 * `@langwatch/workflow-web/studio-host/*` for the project, the transport, the
 * router and the toasts; a port of this family's own would answer none of them.
 *
 * `layoutComponent: DashboardLayout` does not travel — chrome belongs to the
 * route tree.
 */

import { evaluationEditScreens } from "@langwatch/evaluator-web/screens/evaluation-edit";

import type { UiPageLoader, UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import { withWorkflowHost } from "../../../workflows/ui/sections/workflows-host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

const evaluationEditPage: UiPageLoader = async () => {
  const module = await evaluationEditScreens.evaluationEdit();
  const guarded = withUiPageGuard({ fallbacks: FALLBACKS })(module.default);
  guarded.displayName = "EditTraceCheck";
  return { default: withWorkflowHost(guarded) };
};

export const evaluationPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/evaluations/[id]/edit": evaluationEditPage,
  "pages/[project]/evaluations/[id]/edit/choose": evaluationEditPage,
};
