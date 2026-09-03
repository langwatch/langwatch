/**
 * Which page keys the experiment screens answer, and what they are wrapped in.
 *
 * FIVE KEYS, FOUR SCREENS. `/:project/experiments` is the list;
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
 */

import {
  experimentScreens,
  EXPERIMENTS_PAGE_PERMISSION,
} from "@langwatch/experiment-web/screens/experiments";
import type { ReactNode } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { WorkflowHost } from "../../../workflows/ui/sections/workflows-host";

/** The grant this family's replicate picker asks about, per target project. */
const EXPERIMENT_COPY_PERMISSION = "evaluations:manage";

function ExperimentWorkflowHost({ children }: { children: ReactNode }) {
  return <WorkflowHost copyPermission={EXPERIMENT_COPY_PERMISSION}>{children}</WorkflowHost>;
}

const experimentPage = (
  screen: (typeof experimentScreens)[keyof typeof experimentScreens],
  permission?: string,
) => uiPage({ screen, host: ExperimentWorkflowHost, permission });

export const experimentPageLoaders: UiPageLoaderRegistry = {
  // Only the list had a guard: `evaluations.tsx` was `withPermissionGuard("experiments:view")`.
  "pages/[project]/experiments/index": experimentPage(
    experimentScreens.experiments,
    EXPERIMENTS_PAGE_PERMISSION,
  ),
  // The other four were wrapped in nothing; inventing a guard changes who can reach a page.
  "pages/[project]/experiments/[experiment]": experimentPage(experimentScreens.experimentDetail),
  "pages/[project]/experiments/workbench/index": experimentPage(experimentScreens.newWorkbench),
  "pages/[project]/experiments/workbench/[slug]": experimentPage(experimentScreens.workbench),
  "pages/[project]/evaluations/wizard/[slug]": experimentPage(
    experimentScreens.evaluationWizardRedirect,
  ),
};
