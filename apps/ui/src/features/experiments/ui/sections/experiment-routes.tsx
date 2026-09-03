/**
 * Which page keys the experiment screens answer: five keys, four screens
 * (the retired wizard forwards into one of the other three). The host is
 * the workflow host, whose cache `useTargetName`/`useTargetOutputs` share.
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
