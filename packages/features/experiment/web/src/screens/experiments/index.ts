/**
 * The experiment family, as the browser application mounts it.
 *
 * FIVE ADDRESSES, FOUR SCREENS. `/:project/experiments` is the list;
 * `/:project/experiments/:experiment` the read-only result view for a legacy
 * run; `/:project/experiments/workbench` creates one and forwards to its slug;
 * `/:project/experiments/workbench/:slug` IS the workbench. The fifth,
 * `/:project/evaluations/wizard/:slug`, is the retired wizard's forward — it
 * reads the experiment to decide which of the three destinations can render it,
 * which is why it is a screen and not a route-table redirect.
 *
 * WHY THIS PACKAGE, AND WHERE THE WIZARD SLUG WENT. A key belongs to the family
 * that owns its TRANSPORT. Every read on all five is `experiments.*` and every
 * branch turns on `ExperimentType` and `workbenchState`, both
 * `@langwatch/experiment-contract`'s. The dispatching brief named the wizard as
 * "evaluation's" and offered `@langwatch/evaluation-web` or
 * `@langwatch/evaluator-web` — RECORDED AND OVERRULED, on the ownership rule the
 * same brief names: the wizard makes no evaluation call, no evaluator call and
 * no monitor call, it reads one experiment and forwards to a workbench in this
 * package. Standing up a package for a 59-line forward whose whole vocabulary
 * is this family's would have been the disproportion the S7 scim ruling names.
 *
 * WHAT THE OWNING FRONTEND FEATURE MOUNTS is the WORKFLOW host, not one of this
 * family's own: `experiments-v3`'s hooks were moved into this package by the
 * studio slice and already answer to `@langwatch/workflow-web/studio-host/*` for
 * the project, the transport, the router, the toasts and the errors. Inventing
 * a second port for the same five readings would have split the tRPC cache and
 * left `useTargetName` answering to a host nothing mounted.
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
