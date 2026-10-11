import {
  type ClickHouseQueryClient,
  type FillIdIndexesOptions,
  fillIdIndexes,
  type IdIndexDeclaration,
  type IdIndexFillReport,
  idIndexFillTargets,
} from "@langwatch/clickhouse-client";

import { GatewayIdIndexFillRepository } from "../gateway-id-index-fill.repository.ts";

/** The indexes goose 00118 creates, in the order the fill visits them. */
export const GATEWAY_ID_INDEXES: readonly IdIndexDeclaration[] = [
  {
    source: "gateway_spend",
    index: "gateway_spend_id_index",
    key: ["GatewayRequestId"],
    time: "OccurredAt",
    retentionAnchor: "OccurredAt",
    retention: "none",
  },
  {
    source: "gateway_budget_ledger_events",
    index: "gateway_budget_ledger_events_id_index",
    key: ["GatewayRequestId"],
    time: "OccurredAt",
    retentionAnchor: "OccurredAt",
    retention: "none",
  },
];

/** Fills the id indexes on the shared server and every private one, through the routed client. */
export class GatewayIdIndexFillClickHouseRepository extends GatewayIdIndexFillRepository {
  static create({
    clickhouse,
  }: {
    clickhouse: ClickHouseQueryClient;
  }): GatewayIdIndexFillClickHouseRepository {
    return new GatewayIdIndexFillClickHouseRepository(clickhouse);
  }

  private constructor(private readonly clickhouse: ClickHouseQueryClient) {
    super();
  }

  fill(
    input: Omit<FillIdIndexesOptions, "statements" | "targets" | "indexes">,
  ): Promise<IdIndexFillReport> {
    return fillIdIndexes({
      ...input,
      indexes: GATEWAY_ID_INDEXES,
      statements: this.clickhouse,
      targets: idIndexFillTargets({ privateRoutes: this.clickhouse.privateRoutes() }),
    });
  }
}
