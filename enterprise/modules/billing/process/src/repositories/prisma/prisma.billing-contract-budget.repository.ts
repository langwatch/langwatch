// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { CONTRACT_BUDGET_EXTERNAL_ID } from "@langwatch/enterprise-connect-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { fromDate } from "@langwatch/time";

import {
  BillingContractBudgetRepository,
  type BillingContractBudgetRecord,
} from "../billing-contract-budget.repository.ts";

/** Only the shared delegate this reader touches; it claims no table (R40). */
type PrismaBillingContractBudgetDatabase = Pick<PrismaClient, "gatewayBudget">;

const CENTS_PER_USD = 100;

/** Gateway's `GatewayBudget` rows, through the share gateway declares with billing. */
export class PrismaBillingContractBudgetRepository extends BillingContractBudgetRepository {
  private constructor(private readonly prisma: PrismaBillingContractBudgetDatabase) {
    super();
  }

  static create(
    prisma: PrismaBillingContractBudgetDatabase,
  ): PrismaBillingContractBudgetRepository {
    return new PrismaBillingContractBudgetRepository(prisma);
  }

  async findContractBudget({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BillingContractBudgetRecord[]> {
    const rows = await this.prisma.gatewayBudget.findMany({
      where: { organizationId, externalId: CONTRACT_BUDGET_EXTERNAL_ID, archivedAt: null },
      select: {
        id: true,
        scopeId: true,
        providerKey: true,
        limitUsd: true,
        currentPeriodStartedAt: true,
      },
    });

    return rows.map((row) => ({
      id: row.id,
      scopeId: row.scopeId,
      providerKey: row.providerKey,
      limitUsdCents: Math.round(Number(row.limitUsd.toString()) * CENTS_PER_USD),
      currentPeriodStartedAt: fromDate(row.currentPeriodStartedAt),
    }));
  }
}
