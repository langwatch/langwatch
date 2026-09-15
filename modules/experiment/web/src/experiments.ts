/**
 * The experiment family, as the browser application mounts it.
 */

import type { ComponentType } from "react";

export type ExperimentScreenLoader = () => Promise<{ default: ComponentType }>;

export const experimentScreens = {
  experiments: () => import("./ui/sections/experiments/experiments.screen.tsx"),
  experimentDetail: () => import("./ui/sections/experiments/experiment-detail.screen.tsx"),
  newWorkbench: () => import("./ui/sections/experiments/new-workbench.screen.tsx"),
  workbench: () => import("./ui/sections/experiments/workbench.screen.tsx"),
  evaluationWizardRedirect: () => import("./ui/sections/experiments/evaluation-wizard-redirect.screen.tsx"),
} as const satisfies Record<string, ExperimentScreenLoader>;

export type ExperimentScreenName = keyof typeof experimentScreens;

export { EXPERIMENTS_PAGE_PERMISSION } from "./ui/sections/experiments/experiments.screen.tsx";
