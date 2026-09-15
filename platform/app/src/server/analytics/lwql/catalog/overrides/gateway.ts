/**
 * Overrides for AI Gateway spend and budget tracking views.
 *
 * All tables track spend in USD (decimal and nano-USD formats) and are costs-gated
 * where applicable. Billable events are metadata events without cost gating.
 *
 * `gateway_budget_totals` is the `AggregatingMergeTree` scope-totals rollup: it
 * declares `aggregating`, and the builder finalises each `AggregateFunction`
 * state (sum/count) with its merge combinator under a `GROUP BY` the engine key.
 */

import type { DatasetOverride } from "../defineDatasetFromTable";

export const GATEWAY_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  gateway_spend: {
    name: "gateway_request_spend",
    description: "Individual API request spend and reconciliation details",
    grain: "one row per GatewayRequestId",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "EventTimestamp" },
    columnGates: {
      CostNanoUSD: ["costs"],
      // MetadataMap (migration 00076) is Map(String, String) materialised from
      // the free-form `Metadata` JSON, which the default classifier gates
      // `output`. The content filter applied to every exposed map only strips
      // known LLM-content keys (gen_ai.prompt, …), never arbitrary
      // customer-supplied metadata keys/values, so the map re-exposes the same
      // captured content its own source column is gated for. It must carry the
      // same gate.
      MetadataMap: ["output"],
    },
  },
  gateway_budget_scope_totals: {
    name: "gateway_budget_totals",
    description:
      "Per-scope budget totals, merged from the aggregating rollup: spend, token counts and request count per budget window.",
    // AggregatingMergeTree: each measure is an AggregateFunction(sum/count)
    // state finalised with sumMerge/countMerge under a GROUP BY the engine key.
    dedup: { aggregating: true },
    timeColumn: "PeriodStart",
  },
  gateway_budget_ledger_events: {
    name: "gateway_budget_ledger",
    description:
      "Budget ledger entries per request with token counts and spend",
    grain: "one row per (BudgetId, GatewayRequestId)",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "EventTimestamp" },
    columnGates: {
      AmountUSD: ["costs"],
      AmountNanoUSD: ["costs"],
    },
  },
  billable_events: {
    name: "billing_events",
    description: "Billing events for customer invoice generation",
    grain: "one row per DeduplicationKeyHash",
    timeColumn: "EventTimestamp",
    dedup: { versionColumn: "UpdatedAt" },
  },
};
