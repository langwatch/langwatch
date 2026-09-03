/**
 * Which page keys the experiment screens answer, and what they are wrapped in.
 *
 * FIVE KEYS, FOUR SCREENS. `/:project/experiments` is the list — and its key
 * used to resolve a NAMED export (`GuardedExperimentsPage`) of the evaluations
 * module, because the wrapper `withPermissionGuard` produced was what that
 * address served. The wrapper is the route's now, so the module has a plain
 * default and the key names it; nothing about the URL changed.
 *
 * `/:project/experiments/workbench` creates an experiment and forwards to its
 * slug, `/:project/experiments/workbench/:slug` IS the workbench, and
 * `/:project/experiments/:experiment` is the read-only view for a legacy run.
 * `/:project/evaluations/wizard/:slug` is the retired wizard's forward, which
 * reads the experiment to decide which of the three can render it.
 *
 * THE HOST IS THE WORKFLOW HOST, and that is not a shortcut. The studio slice
 * moved `experiments-v3` into `@langwatch/experiment-web` already wired to
 * `@langwatch/workflow-web/studio-host/*` — `useTargetName` and
 * `useTargetOutputs` read the project and the transport through it — so a port
 * of this family's own would have split the tRPC cache and left those hooks
 * asking a host nothing mounted. The copy permission is told to the host rather
 * than assumed: this family's replicate dialog asks `evaluations:manage`.
 *
 * ONLY THE LIST HAD A GUARD, and the asymmetry is the platform pages' own:
 * `evaluations.tsx` was `withPermissionGuard("experiments:view")` and the other
 * four were wrapped in nothing. Inventing a guard is a change to who can reach
 * a page, which a page move does not own.
 *
 * `layoutComponent: DashboardLayout` was the other half of the list page's call
 * and does not travel — chrome belongs to the route tree.
 */

import {
  experimentScreens,
  EXPERIMENTS_PAGE_PERMISSION,
} from "@langwatch/experiment-web/screens/experiments";
import type { ComponentType } from "react";

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

/** The grant this family's replicate picker asks about, per target project. */
const EXPERIMENT_COPY_PERMISSION = "evaluations:manage";

function experimentPage(
  screen: () => Promise<{ default: ComponentType }>,
  { permission, displayName }: { permission?: string; displayName: string },
): UiPageLoader {
  return async () => {
    const module = await screen();
    const guarded = withUiPageGuard({
      ...(permission ? { permission } : {}),
      fallbacks: FALLBACKS,
    })(module.default);
    guarded.displayName = displayName;
    return {
      default: withWorkflowHost(guarded, { copyPermission: EXPERIMENT_COPY_PERMISSION }),
    };
  };
}

export const experimentPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/experiments/index": experimentPage(experimentScreens.experiments, {
    permission: EXPERIMENTS_PAGE_PERMISSION,
    displayName: "ExperimentsPage",
  }),
  "pages/[project]/experiments/[experiment]": experimentPage(
    experimentScreens.experimentDetail,
    { displayName: "ExperimentPage" },
  ),
  "pages/[project]/experiments/workbench/index": experimentPage(
    experimentScreens.newWorkbench,
    { displayName: "NewExperimentWorkbench" },
  ),
  "pages/[project]/experiments/workbench/[slug]": experimentPage(experimentScreens.workbench, {
    displayName: "ExperimentsWorkbenchPage",
  }),
  "pages/[project]/evaluations/wizard/[slug]": experimentPage(
    experimentScreens.evaluationWizardRedirect,
    { displayName: "EvaluationWizardRedirect" },
  ),
};
