/**
 * Data-access for GatewayBudget + GatewayBudgetLedger. The debit path is the
 * hot path from the Go gateway and must be idempotent per
 * `(budgetId, gatewayRequestId)`.
 */
import type {
  GatewayBudget,
  GatewayBudgetLedgerStatus,
  GatewayBudgetScopeType,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { Prisma as PrismaNs } from "@prisma/client";

export type ApplicableScopes = {
  organizationId: string;
  teamId: string;
  projectId: string;
  virtualKeyId: string;
  principalUserId?: string | null;
};

export type DebitLineItem = {
  budgetId: string;
  scope: GatewayBudgetScopeType;
  scopeId: string;
  spentUsd: string; // Decimal as string for JSON
  remainingUsd: string;
  limitUsd: string;
  deduped: boolean;
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

  /**
   * Insert a ledger entry and atomically bump the matching budget's spent
   * counter. Returns the line item. On unique-constraint violation (same
   * gateway_request_id already recorded), returns the existing spend values
   * with `deduped=true`.
   */
  async debit(
    args: {
      budget: GatewayBudget;
      gatewayRequestId: string;
      virtualKeyId: string;
      providerCredentialId?: string | null;
      amountUsd: PrismaNs.Decimal;
      tokensInput: number;
      tokensOutput: number;
      tokensCacheRead: number;
      tokensCacheWrite: number;
      model: string;
      providerSlot?: string | null;
      durationMs?: number | null;
      status: GatewayBudgetLedgerStatus;
    },
    tx?: Prisma.TransactionClient,
  ): Promise<DebitLineItem> {
    const client = tx ?? this.prisma;

    try {
      await client.gatewayBudgetLedger.create({
        data: {
          budgetId: args.budget.id,
          virtualKeyId: args.virtualKeyId,
          providerCredentialId: args.providerCredentialId ?? null,
          gatewayRequestId: args.gatewayRequestId,
          amountUsd: args.amountUsd,
          tokensInput: args.tokensInput,
          tokensOutput: args.tokensOutput,
          tokensCacheRead: args.tokensCacheRead,
          tokensCacheWrite: args.tokensCacheWrite,
          model: args.model,
          providerSlot: args.providerSlot ?? null,
          durationMs: args.durationMs ?? null,
          status: args.status,
        },
      });

      const updated = await client.gatewayBudget.update({
        where: { id: args.budget.id },
        data: { spentUsd: { increment: args.amountUsd } },
      });

      return renderLine(updated, false);
    } catch (err) {
      if (
        err instanceof PrismaNs.PrismaClientKnownRequestError &&
        err.code === "P2002"
      ) {
        // Idempotent replay — return current state unchanged.
        const current = await client.gatewayBudget.findUnique({
          where: { id: args.budget.id },
        });
        if (!current) throw err;
        return renderLine(current, true);
      }
      throw err;
    }
  }
}

function renderLine(b: GatewayBudget, deduped: boolean): DebitLineItem {
  const limit = b.limitUsd.toString();
  const spent = b.spentUsd.toString();
  return {
    budgetId: b.id,
    scope: b.scopeType,
    scopeId: b.scopeId,
    limitUsd: limit,
    spentUsd: spent,
    remainingUsd: subtract(limit, spent),
    deduped,
  };
}

function subtract(a: string, b: string): string {
  const x = Number.parseFloat(a);
  const y = Number.parseFloat(b);
  return (x - y).toFixed(6);
}
