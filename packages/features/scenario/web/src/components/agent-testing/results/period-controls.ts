/**
 * The window controls the results views hand down unchanged, so that each one
 * reads and moves the same window.
 */

import type { RunPlanDetailProps } from "./run-plan-detail";

export type PeriodControls = Pick<
  RunPlanDetailProps,
  "period" | "periodMode" | "setPeriod" | "setRelativePeriod"
>;
