import type { BudgetCrossingKind } from "@langwatch/gateway-contract";

/** How much of a budget is spent before it warns; the data plane's `SoftWarnPercent`. */
const BUDGET_SOFT_WARN_PERCENT = 80;

/** A crossing's kind, or `not_crossed` below the warn line or without a positive limit. */
type BudgetCrossingDecision = BudgetCrossingKind | "not_crossed";

/** Breached once spend reaches the limit, threshold at the soft warn line. */
export function budgetCrossingKind({
  spentUsd,
  limitUsd,
}: {
  spentUsd: number;
  limitUsd: number;
}): BudgetCrossingDecision {
  if (limitUsd <= 0) return "not_crossed";
  const percent = (spentUsd * 100) / limitUsd;
  if (percent >= 100) return "breached";
  if (percent >= BUDGET_SOFT_WARN_PERCENT) return "threshold_crossed";
  return "not_crossed";
}
