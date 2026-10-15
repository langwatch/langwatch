import { defineIdIndex, type IdIndexDeclaration } from "@langwatch/clickhouse-client";

/** The indexes goose 00118 creates, in the order the fill visits them. */
export const GATEWAY_ID_INDEXES: readonly IdIndexDeclaration[] = [
  defineIdIndex({
    source: "gateway_spend",
    key: ["GatewayRequestId"],
    time: "OccurredAt",
    retention: "none",
  }),
  defineIdIndex({
    source: "gateway_budget_ledger_events",
    key: ["GatewayRequestId"],
    time: "OccurredAt",
    retention: "none",
  }),
];
