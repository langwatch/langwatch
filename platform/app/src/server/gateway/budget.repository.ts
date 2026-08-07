/**
 * Data-access for GatewayBudget. The debit path is gone; cost lands in the
 * ClickHouse `gateway_budget_ledger_events` table, written by the debits
 * process manager on the gateway-spend pipeline (see
 * budget.clickhouse.repository.ts + gatewayDebits.process.ts).
 *
 * Selection of "which budgets apply" lives in
 * `budgetResolution.service.ts` and nowhere else: this repository is a
 * thin pass-through so callers that only want the rows keep working while
 * callers that need per-member buckets (GROUP) or the provider filter read
 * the resolver directly.
 */
import type { GatewayBudget, Prisma, PrismaClient } from "~/generated/prisma/client";

import {
  type ResolvedBudget,
  resolveApplicableBudgets,
} from "./budgetResolution.service";

export type ApplicableScopes = {
  organizationId: string;
  teamId: string;
  projectId: string;
  virtualKeyId: string;
  principalUserId?: string | null;
};

export class GatewayBudgetRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /** Resolved buckets, including per-member GROUP fan-out. */
  async resolveForRequest(
    scopes: ApplicableScopes,
    tx?: Prisma.TransactionClient,
  ): Promise<ResolvedBudget[]> {
    return resolveApplicableBudgets(tx ?? this.prisma, scopes);
  }

  async applicableForRequest(
    scopes: ApplicableScopes,
    tx?: Prisma.TransactionClient,
  ): Promise<GatewayBudget[]> {
    const resolved = await this.resolveForRequest(scopes, tx);
    return resolved.map((r) => r.budget);
  }
}
