// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  type GatewaySpendByRequestTypeQuery,
  parseSummedNanoUsd,
} from "@langwatch/gateway-contract";

import {
  BillingGatewaySpendRepository,
  type BudgetBucketSpendQuery,
} from "../billing-gateway-spend.repository.ts";

/**
 * Gateway's `gateway_spend` and `gateway_budget_ledger_events` through its shares: one row per
 * request at its latest status, so each read is FINAL; the window bounds `OccurredAt` so month
 * partitions prune.
 */
export class ClickHouseBillingGatewaySpendRepository extends BillingGatewaySpendRepository {
  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  static create(clickhouse: ClickHouseQueryClient): ClickHouseBillingGatewaySpendRepository {
    return new ClickHouseBillingGatewaySpendRepository(clickhouse);
  }

  isSpendSourceAvailable(): boolean {
    return true;
  }

  async sumSpendNanoUsdByRequestType({
    tenantIds,
    requestType,
    fromMs,
    toMs,
  }: GatewaySpendByRequestTypeQuery): Promise<number> {
    const [tenantId] = tenantIds;
    if (tenantId === undefined) return 0;
    const tenants = tenantIds.map((_, index) => `{tenant${index}:String}`).join(", ");
    const window = [
      fromMs === undefined ? "" : "AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})",
      toMs === undefined ? "" : "AND OccurredAt < fromUnixTimestamp64Milli({toMs:Int64})",
    ];
    const { rows } = await this.clickhouse.query<{ CostNanoUSD: unknown }>({
      tenantId,
      tenantIds,
      table: "gateway_spend",
      sql: `
        SELECT sum(CostNanoUSD) AS CostNanoUSD
        FROM gateway_spend FINAL
        WHERE TenantId IN (${tenants})
          AND RequestType = {requestType:String}
          AND Status = 'confirmed'
          ${window.join("\n          ")}
      `,
      params: {
        ...Object.fromEntries(tenantIds.map((id, index) => [`tenant${index}`, id])),
        requestType,
        ...(fromMs === undefined ? {} : { fromMs }),
        ...(toMs === undefined ? {} : { toMs }),
      },
    });

    return parseSummedNanoUsd(rows[0]?.CostNanoUSD ?? 0);
  }

  /** Gateway's floored budget read for one exact bucket: `Status = 'success'` since the floor. */
  async sumBudgetSpendNanoUsd({
    tenantIds,
    budgetId,
    bucketScopeId,
    fromMs,
  }: BudgetBucketSpendQuery): Promise<number> {
    const [tenantId] = tenantIds;
    if (tenantId === undefined) return 0;
    const tenants = tenantIds.map((_, index) => `{tenant${index}:String}`).join(", ");
    const { rows } = await this.clickhouse.query<{ AmountNanoUSD: unknown }>({
      tenantId,
      tenantIds,
      table: "gateway_budget_ledger_events",
      sql: `
        SELECT toString(sum(AmountNanoUSD)) AS AmountNanoUSD
        FROM gateway_budget_ledger_events FINAL
        WHERE TenantId IN (${tenants})
          AND Status = 'success'
          AND BudgetId = {budgetId:String}
          AND ScopeId = {bucketScopeId:String}
          AND OccurredAt >= fromUnixTimestamp64Milli({fromMs:Int64})
      `,
      params: {
        ...Object.fromEntries(tenantIds.map((id, index) => [`tenant${index}`, id])),
        budgetId,
        bucketScopeId,
        fromMs,
      },
    });

    return parseSummedNanoUsd(rows[0]?.AmountNanoUSD ?? 0);
  }
}
