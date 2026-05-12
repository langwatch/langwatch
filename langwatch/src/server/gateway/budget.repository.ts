/**
 * Data-access for GatewayBudget. The debit path is gone; cost is folded
 * into the ClickHouse `gateway_budget_ledger_events` table by the
 * trace-fold reactor (see budget.clickhouse.repository.ts +
 * gatewayBudgetSync.reactor.ts). This repo now only resolves the set of
 * applicable budgets for a given request — the same lookup is used by
 * the trace-fold reactor when deciding which budgets to attribute spend
 * to, and by the runtime budget check when deciding which scopes to
 * sum CH spend across.
 */
import type {
  GatewayBudget,
  Prisma,
  PrismaClient,
} from "@prisma/client";

export type ApplicableScopes = {
  organizationId: string;
  teamId: string;
  projectId: string;
  virtualKeyId: string;
  principalUserId?: string | null;
};

export class GatewayBudgetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async applicableForRequest(
    scopes: ApplicableScopes,
    tx?: Prisma.TransactionClient,
  ): Promise<GatewayBudget[]> {
    const client = tx ?? this.prisma;
    return client.gatewayBudget.findMany({
      where: {
        organizationId: scopes.organizationId,
        archivedAt: null,
        OR: [
          { scopeType: "ORGANIZATION", scopeId: scopes.organizationId },
          { scopeType: "TEAM", scopeId: scopes.teamId },
          { scopeType: "PROJECT", scopeId: scopes.projectId },
          { scopeType: "VIRTUAL_KEY", scopeId: scopes.virtualKeyId },
          scopes.principalUserId
            ? { scopeType: "PRINCIPAL", scopeId: scopes.principalUserId }
            : { id: "__never__" },
        ],
      },
    });
  }
}
