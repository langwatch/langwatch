// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { GatewaySpendByRequestTypeQuery } from "@langwatch/gateway-contract";

import {
  BillingGatewaySpendRepository,
  type BudgetBucketSpendQuery,
} from "../billing-gateway-spend.repository.ts";
import type { MemoryBillingStore } from "./memory.billing.store.ts";

/** The ClickHouse read's twin over the store's ledger rows. */
export class MemoryBillingGatewaySpendRepository extends BillingGatewaySpendRepository {
  private constructor(private readonly store: MemoryBillingStore) {
    super();
  }

  static create(store: MemoryBillingStore): MemoryBillingGatewaySpendRepository {
    return new MemoryBillingGatewaySpendRepository(store);
  }

  isSpendSourceAvailable(): boolean {
    return this.store.spendSourceAvailable;
  }

  async sumSpendNanoUsdByRequestType({
    tenantIds,
    requestType,
    fromMs,
    toMs,
  }: GatewaySpendByRequestTypeQuery): Promise<number> {
    const tenants = new Set(tenantIds);

    return this.store.gatewaySpend
      .filter(
        (row) =>
          tenants.has(row.tenantId) &&
          row.requestType === requestType &&
          row.status === "confirmed" &&
          (fromMs === undefined || row.occurredAtMs >= fromMs) &&
          (toMs === undefined || row.occurredAtMs < toMs),
      )
      .reduce((total, row) => total + row.costNanoUsd, 0);
  }

  async sumBudgetSpendNanoUsd({
    tenantIds,
    budgetId,
    bucketScopeId,
    fromMs,
  }: BudgetBucketSpendQuery): Promise<number> {
    const tenants = new Set(tenantIds);

    return this.store.budgetLedger
      .filter(
        (row) =>
          tenants.has(row.tenantId) &&
          row.budgetId === budgetId &&
          row.scopeId === bucketScopeId &&
          row.status === "success" &&
          row.occurredAtMs >= fromMs,
      )
      .reduce((total, row) => total + row.amountNanoUsd, 0);
  }
}
