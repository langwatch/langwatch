import type { GatewayBudget, PrismaClient } from "@langwatch/prisma-client/generated";
import { GatewayBudgetOverviewRepository } from "../gateway-budget-overview.repository";

/** The client slice the budget-detail overview binds to. */
export type GatewayBudgetOverviewDatabase = Pick<PrismaClient, "gatewayBudget">;

/** Private Prisma owner for the budget row a detail overview reports on. */
export class PrismaGatewayBudgetOverviewRepository extends GatewayBudgetOverviewRepository {
  static create(input: {
    database: GatewayBudgetOverviewDatabase;
  }): PrismaGatewayBudgetOverviewRepository {
    return new PrismaGatewayBudgetOverviewRepository(input.database);
  }

  private constructor(private readonly database: GatewayBudgetOverviewDatabase) {
    super();
  }

  tryFindBudget({
    organizationId,
    budgetId,
  }: {
    organizationId: string;
    budgetId: string;
  }): Promise<GatewayBudget | null> {
    return this.database.gatewayBudget.findFirst({
      where: { id: budgetId, organizationId },
    });
  }
}
