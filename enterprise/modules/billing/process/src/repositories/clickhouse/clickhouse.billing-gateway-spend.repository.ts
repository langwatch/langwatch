// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { clickhouseRead, fn, tenantScope } from "@langwatch/clickhouse-client/builder";
import {
  type GatewaySpendByRequestTypeQuery,
  parseSummedNanoUsd,
} from "@langwatch/gateway-contract";

import {
  BillingGatewaySpendRepository,
  type BudgetBucketSpendQuery,
} from "../billing-gateway-spend.repository.ts";
import { gatewayBudgetLedgerEvents } from "./clickhouse.gateway-budget-ledger-events.table.ts";
import { gatewaySpend } from "./clickhouse.gateway-spend.table.ts";

/**
 * Gateway's `gateway_spend` and `gateway_budget_ledger_events` through its shares: one row per
 * request at its latest status, so each read is FINAL; the window bounds `OccurredAt` so month
 * partitions prune.
 */
export class ClickHouseBillingGatewaySpendRepository extends BillingGatewaySpendRepository {
  private constructor(private readonly clickhouse: Pick<ClickHouseQueryClient, "read">) {
    super();
  }

  static create(
    clickhouse: Pick<ClickHouseQueryClient, "read">,
  ): ClickHouseBillingGatewaySpendRepository {
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
    if (tenantIds.length === 0) return 0;
    let read = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
      .from(gatewaySpend)
      .final()
      .select({ SumCostNanoUSD: fn.sum(gatewaySpend.CostNanoUSD) })
      .where(({ and, eq }) =>
        and(eq(gatewaySpend.RequestType, requestType), eq(gatewaySpend.Status, "confirmed")),
      );
    if (fromMs !== undefined) read = read.where(({ gte }) => gte(gatewaySpend.OccurredAt, fromMs));
    if (toMs !== undefined) read = read.where(({ lt }) => lt(gatewaySpend.OccurredAt, toMs));
    const { rows } = await this.clickhouse.read({ statement: read.build() });

    return parseSummedNanoUsd(rows[0]?.SumCostNanoUSD ?? 0);
  }

  /** Gateway's floored budget read for one exact bucket: `Status = 'success'` since the floor. */
  async sumBudgetSpendNanoUsd({
    tenantIds,
    budgetId,
    bucketScopeId,
    fromMs,
  }: BudgetBucketSpendQuery): Promise<number> {
    if (tenantIds.length === 0) return 0;
    const ledger = gatewayBudgetLedgerEvents;
    const statement = clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
      .from(ledger)
      .final()
      .select({ SpentNanoUSD: fn.toString(fn.sum(ledger.AmountNanoUSD)) })
      .where(({ and, eq, gte }) =>
        and(
          eq(ledger.Status, "success"),
          eq(ledger.BudgetId, budgetId),
          eq(ledger.ScopeId, bucketScopeId),
          gte(ledger.OccurredAt, fromMs),
        ),
      )
      .build();
    const { rows } = await this.clickhouse.read({ statement });

    return parseSummedNanoUsd(rows[0]?.SpentNanoUSD ?? 0);
  }
}
