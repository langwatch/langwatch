export type CliBudgetOverview = {
  gatewayAccess: boolean;
  budgets: Array<{
    window: string;
    limitUsd: string;
    spentUsd: string;
  }>;
};

export abstract class CliBudgetOverviewPort {
  abstract overviewForUser(input: {
    userId: string;
    organizationId: string;
  }): Promise<CliBudgetOverview>;
}

export abstract class CliAdminContactPort {
  abstract tryResolveAdminEmail(organizationId: string): Promise<string | null>;
}
