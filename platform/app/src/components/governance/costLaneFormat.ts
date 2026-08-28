import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";

/**
 * A cost lane's amount, or an em dash when no figure is held.
 *
 * Every digit decision is delegated to `formatBudgetUsd`; this only moves the
 * sign. That function's magnitude branches all test `>=`, so a negative falls
 * through to the six-decimal tail and renders as `$-12.5`. A refund-heavy
 * billed day is a real case on this screen, and `-$12.50` is the same number
 * read the way a bill reads it.
 *
 * Null stays null all the way to the string: `formatBudgetUsd` answers an em
 * dash, never `$0.00`. A zero here would be a claim that nothing was spent.
 */
export function formatLaneUsd(amountUsd: number | null): string {
  if (amountUsd === null || amountUsd >= 0) return formatBudgetUsd(amountUsd);
  return `-${formatBudgetUsd(Math.abs(amountUsd))}`;
}
