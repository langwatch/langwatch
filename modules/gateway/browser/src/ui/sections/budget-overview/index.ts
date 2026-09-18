/**
 * Gateway-owned budget surfaces rendered by personal-workspace; surfaces cross
 * feature boundaries per ADR-004.
 */

export { formatBudgetUsd } from "../../../model/format-budget-usd.ts";
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
} from "./budget-overview-list.tsx";
export { BudgetExceededBanner, type BudgetExceededBannerProps } from "./budget-exceeded-banner.tsx";
export { spentSubline } from "./spent-subline.ts";
