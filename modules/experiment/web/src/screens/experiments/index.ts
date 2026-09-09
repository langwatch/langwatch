/**
 * The experiment family, as the browser application mounts it.
 */

import type { ComponentType } from "react";

export type ExperimentScreenLoader = () => Promise<{ default: ComponentType }>;

export const experimentScreens = {
  experiments: () => import("./experiments.screen.tsx"),
  experimentDetail: () => import("./experiment-detail.screen.tsx"),
  newWorkbench: () => import("./new-workbench.screen.tsx"),
  workbench: () => import("./workbench.screen.tsx"),
  evaluationWizardRedirect: () => import("./evaluation-wizard-redirect.screen.tsx"),
} as const satisfies Record<string, ExperimentScreenLoader>;

export type ExperimentScreenName = keyof typeof experimentScreens;

export { EXPERIMENTS_PAGE_PERMISSION } from "./experiments.screen.tsx";
