import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { GatewayKeyReachRow } from "../gateway-budget.repository.ts";

/** The client slice the reach walk reads. */
type GatewayBudgetScopeReachDatabase = Pick<PrismaClient, "virtualKey">;

/** Gateway-owned active-key facts used by the budget reach policy. */
export class PrismaGatewayBudgetScopeReachRepository {
  private constructor(private readonly database: GatewayBudgetScopeReachDatabase) {}

  static create(
    database: GatewayBudgetScopeReachDatabase,
  ): PrismaGatewayBudgetScopeReachRepository {
    return new PrismaGatewayBudgetScopeReachRepository(database);
  }

  async findAll(organizationId: string): Promise<GatewayKeyReachRow[]> {
    const keys = await this.database.virtualKey.findMany({
      where: { organizationId, status: "ACTIVE" },
      include: { scopes: true },
    });

    return keys.map((key) => ({
      organizationId: key.organizationId,
      scopedTeamIds: key.scopes
        .filter((scope) => scope.scopeType === "TEAM")
        .map((scope) => scope.scopeId),
      traceProjectId: key.traceProjectId,
      virtualKeyId: key.id,
      principalUserId: key.principalUserId,
    }));
  }
}
