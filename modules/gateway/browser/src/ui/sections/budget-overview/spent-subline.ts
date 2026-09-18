import { formatBudgetUsd } from "../../../model/format-budget-usd.ts";

/** Reports bundled spend only; avoids budget mention which governs AI-Gateway, not tools. */
export function spentSubline({ bundledUsd }: { bundledUsd: number }): string {
  return bundledUsd > 0 ? `${formatBudgetUsd(bundledUsd)} bundled` : "";
}
