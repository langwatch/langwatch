/**
 * The budget surfaces a member's own pages render.
 *
 * A budget is the AI Gateway's, wherever it is shown. These three moved here
 * with the personal-workspace family because that family is where they are
 * rendered — the `/me` dashboard, its settings page and its budget-increase
 * request — but the money they format, the windows they name and the thresholds
 * they judge by are the gateway's, and so is `formatBudgetUsd`, which was
 * already here and which all three call.
 *
 * A SURFACE rather than a screen, because the screens that render them belong
 * to another feature: ADR-004 makes a screen owner-only and a surface the
 * explicit way one feature's presentation reaches another's page.
 */

export { formatBudgetUsd } from "../../model/format-budget-usd";
export {
  BudgetOverviewList,
  budgetDescription,
  budgetPctUsed,
  formatResetDay,
  isBudgetBreached,
  isBudgetNearLimit,
  windowAdjective,
  windowPhrase,
  type BudgetOverviewItemView,
} from "./budget-overview-list";
export { BudgetExceededBanner, type BudgetExceededBannerProps } from "./budget-exceeded-banner";
export { spentSubline } from "./spent-subline";
