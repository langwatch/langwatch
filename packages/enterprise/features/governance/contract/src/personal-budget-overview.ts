export type GovernanceBudgetOverviewInput = {
  organizationId: string;
  userId: string;
  includeTopModels?: boolean;
};

export type GovernanceBudgetOverviewItem = {
  id: string;
  name: string;
  scopeType: string;
  scopeId: string;
  scopeLabel: string;
  window: string;
  limitUsd: string;
  spentUsd: string;
  onBreach: string;
  timezone: string | null;
  providerKey: string | null;
  providerLabel: string | null;
  isPerMember: boolean;
  managedByVirtualKeyId: string | null;
  scopeClass:
    | "organization"
    | "team"
    | "project"
    | "personal"
    | "key"
    | "department"
    | "other";
  scopePhrase: string;
  resetsAt: string | null;
  topModels?: Array<{ model: string; spentUsd: number }>;
};

export type GovernanceBudgetOverviewForUser = {
  gatewayAccess: boolean;
  reason?: "flag_off" | "no_membership";
  budgets: GovernanceBudgetOverviewItem[];
};
