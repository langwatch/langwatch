import type { GatewayBudget } from "@langwatch/gateway-contract";

/**
 * The one row a budget-detail overview starts from. Scoped by organization as
 * well as id, so a budget id from somewhere unexpected resolves nothing.
 */
export abstract class GatewayBudgetOverviewRepository {
  abstract tryFindBudget(input: {
    organizationId: string;
    budgetId: string;
  }): Promise<GatewayBudget | null>;
}
