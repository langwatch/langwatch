/**
 * Overrides for AI Gateway spend and budget tracking datasets.
 *
 * All tables track spend in USD (decimal and nano-USD formats) and are costs-gated
 * where applicable. Billable events are metadata events without cost gating.
 *
 * `gateway_budget_scope_totals` is NOT here: it is an `AggregatingMergeTree`
 * with `AggregateFunction`-state columns (sum/count/max) the derived builder
 * cannot merge correctly — skipped with a reason in `../skippedTables.ts`.
 */

import type { Partial } from "lodash";
import type { DatasetOverride } from "../defineDatasetFromTable";

export const GATEWAY_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  gateway_spend: {
    name: "gateway_request_spend",
    description: "Individual API request spend and reconciliation details",
    grain: "one row per GatewayRequestId",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "EventTimestamp" },
    // The derived builder exposes a Map column as a plain pass-through, with
    // no per-key content filter — the catalog-wide guard
    // (lwqlViewCatalog.unit.test.ts, "filters the content keys out of every
    // map column") requires every exposed map to filter, which only a
    // hand-written `contentFilteredMapSql` expression can do. Dropped rather
    // than exposed unfiltered; nothing else on this dataset reads it.
    skipColumns: ["MetadataMap"],
    columnGates: {
      CostNanoUSD: ["costs"],
    },
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
