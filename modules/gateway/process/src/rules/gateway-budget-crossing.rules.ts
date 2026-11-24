import {
  type BudgetCrossingKind,
  type GatewayBudgetWindow,
  GatewayWindow,
} from "@langwatch/gateway-contract";
import type { Instant } from "@langwatch/time";

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

/**
 * When the period containing `now` gives way to the next, by the budget's own phase, unix ms.
 * Null for TOTAL and MANUAL: neither rolls, and their far-future sentinel is no period end.
 */
export function computePeriodEndsAtMs({
  budget,
  now,
}: {
  budget: { window: GatewayBudgetWindow; cycleAnchorAt: Instant | null; timezone: string | null };
  now: Instant;
}): number | null {
  if (!GatewayWindow.isCyclicWindow(budget.window)) return null;
  return GatewayWindow.nextBoundaryFor({ budget, now }).epochMilliseconds;
}

/**
 * The model a bucket spent most on, and its share of the bucket's spend from 0 to 1; or none,
 * when nothing was spent or the winner carries no name.
 */
export type BucketTopModel =
  | Readonly<{ outcome: "named"; model: string; share: number }>
  | Readonly<{ outcome: "none" }>;

/** Most spend first, then by name, so a redelivered crossing names the same model. */
function byMostSpendThenName(
  left: Readonly<{ model: string; spentNanoUsd: bigint }>,
  right: Readonly<{ model: string; spentNanoUsd: bigint }>,
): number {
  if (left.spentNanoUsd !== right.spentNanoUsd) {
    return left.spentNanoUsd > right.spentNanoUsd ? -1 : 1;
  }
  if (left.model === right.model) return 0;
  return left.model < right.model ? -1 : 1;
}

/** The model with the most spend, ties to the first by name. */
export function topModelOf(
  spend: readonly Readonly<{ model: string; spentNanoUsd: bigint }>[],
): BucketTopModel {
  const total = spend.reduce((sum, { spentNanoUsd }) => sum + spentNanoUsd, 0n);
  const [top] = spend.toSorted(byMostSpendThenName);
  if (total <= 0n || !top?.model || top.spentNanoUsd <= 0n) return { outcome: "none" };
  return {
    outcome: "named",
    model: top.model,
    share: Math.min(1, Number(top.spentNanoUsd) / Number(total)),
  };
}
