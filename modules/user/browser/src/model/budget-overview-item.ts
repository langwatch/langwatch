/**
 * The /me rendering of budgetOverview API: one row per budget binding
 * the user, most binding first. Details in tooltip.
 */
export type BudgetOverviewItemView = {
  id: string;
  name: string;
  scopeClass: string;
  scopePhrase: string;
  scopeLabel: string;
  window: string;
  limitUsd: string;
  spentUsd: string;
  onBreach: string;
  providerLabel: string | null;
  isPerMember: boolean;
  resetsAt: string | null;
  topModels?: { model: string; spentUsd: number }[];
};
