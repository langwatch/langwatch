// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import {
  type GatewaySpendByRequestTypeQuery,
  parseSummedNanoUsd,
} from "@langwatch/gateway-contract";

import { BillingGatewaySpendRepository } from "../billing-gateway-spend.repository.ts";

/**
 * Gateway's `gateway_spend` through its share: one row per request at its latest status, so the
 * read is FINAL; the window bounds `OccurredAt` so month partitions prune.
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
}
