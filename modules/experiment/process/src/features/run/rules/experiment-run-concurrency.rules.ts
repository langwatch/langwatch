import { MAX_CONCURRENCY } from "@langwatch/experiment-contract";

/** How long a run counts as active after its start when no completion removes it. */
export const EXPERIMENT_RUN_ACTIVITY_WINDOW_MS = 2 * 60 * 60 * 1000;

/**
 * A new run's share of the cell budgets: each budget split between the runs already active and
 * this one, the tighter share taken, kept between 1 and MAX_CONCURRENCY. No global budget, no
 * global term.
 */
export function dynamicRunConcurrency({
  projectActiveRuns,
  globalActiveRuns,
  projectBudget,
  globalBudget,
}: {
  projectActiveRuns: number;
  globalActiveRuns: number;
  projectBudget: number;
  globalBudget?: number | undefined;
}): number {
  const projectShare = Math.floor(projectBudget / (projectActiveRuns + 1));
  const globalShare =
    globalBudget === undefined
      ? Number.POSITIVE_INFINITY
      : Math.floor(globalBudget / (globalActiveRuns + 1));
  return Math.min(Math.max(Math.min(projectShare, globalShare), 1), MAX_CONCURRENCY);
}
