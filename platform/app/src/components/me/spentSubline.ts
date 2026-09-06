import { formatBudgetUsd } from "~/components/gateway/formatBudgetUsd";

/**
 * Second line under the "Spent this month" figure on /me.
 *
 * It reports only the bundled portion, the spend carried by a plan rather than
 * billed per token, which is most of a coding-assistant user's usage and would
 * mislead as the headline.
 *
 * Deliberately says nothing about a budget. The budget `user.personalBudget`
 * resolves governs AI-Gateway virtual-key traffic, which is a different ledger
 * from the tool spend this card totals, so rendering "of $X budget" here read
 * as a cap on usage it never governs. The budget keeps the surfaces that are
 * genuinely about it: the /me banners and the gateway budgets page.
 *
 * Spec: specs/ai-gateway/governance/my-usage-dashboard.feature
 */
export function spentSubline({ bundledUsd }: { bundledUsd: number }): string {
  return bundledUsd > 0 ? `${formatBudgetUsd(bundledUsd)} bundled` : "";
}
