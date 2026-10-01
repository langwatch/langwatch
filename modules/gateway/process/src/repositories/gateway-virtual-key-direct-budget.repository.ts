import type { GatewayBudget } from "@langwatch/gateway-contract";

/**
 * The rows behind the cap a key carries on itself: the budgets that target
 * the key, and the projects whose traffic their spend accrues under.
 */
export abstract class VirtualKeyDirectBudgetRepository {
  /**
   * Live budgets scoped to any of these keys or managed from their drawers,
   * oldest first — the order the "oldest wins" tie-break relies on.
   */
  abstract findBudgetsTargetingKeys(input: {
    organizationId: string;
    virtualKeyIds: string[];
  }): Promise<GatewayBudget[]>;
  /**
   * Every project in the organization. ORG/TEAM/PRINCIPAL budgets accrue
   * under whichever project emitted the trace, so all of them are tenants to
   * sum the rollup over.
   */
  abstract findProjectIdsInOrganization(input: { organizationId: string }): Promise<string[]>;
}
