/** Overrides for AI Gateway spend and budget tracking views. */

import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

export const GATEWAY_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  gateway_spend: {
    description: "Individual API request spend and reconciliation details",
    grain: "one row per GatewayRequestId",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "EventTimestamp" },
  },
  gateway_budget_scope_totals: {
    description:
      "Per-scope budget totals, merged from the aggregating rollup: spend, token counts and request count per budget window.",
    // AggregatingMergeTree: each measure is an AggregateFunction(sum/count)
    // state finalised with sumMerge/countMerge under a GROUP BY the engine key.
    dedup: { aggregating: true },
    timeColumn: "PeriodStart",
  },
  gateway_budget_ledger_events: {
    description: "Budget ledger entries per request with token counts and spend",
    grain: "one row per (BudgetId, GatewayRequestId)",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "EventTimestamp" },
  },
  billable_events: {
    description: "Billing events for customer invoice generation",
    grain: "one row per DeduplicationKeyHash",
    timeColumn: "EventTimestamp",
    dedup: { versionColumn: "UpdatedAt" },
  },
};
