/**
 * Overrides for AI Gateway spend and budget tracking datasets.
 *
 * All tables track spend in USD (decimal and nano-USD formats) and are costs-gated
 * where applicable. Billable events are metadata events without cost gating.
 */

import type { Partial } from "lodash";
import type { DatasetOverride } from "../defineDatasetFromTable";

export const GATEWAY_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  gateway_spend: {
    description: "Individual API request spend and reconciliation details",
    grain: "one row per GatewayRequestId",
    timeColumn: "OccurredAt",
    columnGates: {
      CostNanoUSD: ["costs"],
    },
  },
  gateway_budget_ledger_events: {
    description:
      "Budget ledger entries per request with token counts and spend",
    grain: "one row per (BudgetId, GatewayRequestId)",
    timeColumn: "OccurredAt",
    columnGates: {
      AmountUSD: ["costs"],
      AmountNanoUSD: ["costs"],
    },
  },
  gateway_budget_scope_totals: {
    description: "Cumulative spend per budget scope and time window",
    grain: "one row per (BudgetId, Scope, ScopeId, Window, PeriodStart)",
    timeColumn: "PeriodStart",
    dedup: {
      aggregating: true,
    },
    columnGates: {
      SpendUSD: ["costs"],
      SpendNanoUSD: ["costs"],
    },
  },
  billable_events: {
    description: "Billing events for customer invoice generation",
    grain: "one row per DeduplicationKeyHash",
    timeColumn: "EventTimestamp",
  },
};
