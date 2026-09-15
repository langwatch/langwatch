import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { GatewayBudget as GatewayBudgetRow } from "@langwatch/gateway-contract";
import { GatewayBudgetOverviewRepository } from "../gateway-budget-overview.repository.ts";
import { toGatewayBudgetRow } from "./prisma.gateway-budget.repository.ts";

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

  async tryFindBudget({
    organizationId,
    budgetId,
  }: {
    organizationId: string;
    budgetId: string;
  }): Promise<GatewayBudgetRow | null> {
    const row = await this.database.gatewayBudget.findFirst({
      where: { id: budgetId, organizationId },
    });

    return row ? toGatewayBudgetRow(row) : null;
  }
}
