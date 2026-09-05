/**
 * The experiment family, as the browser application mounts it.
 */

import type { ComponentType } from "react";

export type ExperimentScreenLoader = () => Promise<{ default: ComponentType }>;

export const experimentScreens = {
  experiments: () => import("./experiments.screen"),
  experimentDetail: () => import("./experiment-detail.screen"),
  newWorkbench: () => import("./new-workbench.screen"),
  workbench: () => import("./workbench.screen"),
  evaluationWizardRedirect: () => import("./evaluation-wizard-redirect.screen"),
} as const satisfies Record<string, ExperimentScreenLoader>;

export type ExperimentScreenName = keyof typeof experimentScreens;

export { EXPERIMENTS_PAGE_PERMISSION } from "./experiments.screen";
