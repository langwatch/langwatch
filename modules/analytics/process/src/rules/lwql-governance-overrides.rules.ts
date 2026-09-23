/**
 * Overrides for the governance/OCSF views (#8085 / #8116 Part B, user decision: visibility is
 * decided by the row policy, not by omission — see the coordinator scope addition dropping
 * `governance_*` from {@link ../skippedTables#matchesSkipPattern}).
 */

import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

export const GOVERNANCE_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  governance_cost_rollup_1d: {
    name: "governance_daily_cost_rollup",
    description:
      "Daily cost rollups per tenant, provider and model, keyed by the org's " +
      "internal_governance project; visible only to a caller whose project " +
      "set includes it.",
    grain:
      "one row per (TenantId, Day, CostSource, IngestionSourceId, Provider, Model, AgentId, CurrencyCode, RawActorId)",
    timeColumn: "Day",
    dedup: { versionColumn: "EventTimestamp" },
    columnGates: {
      AmountNanoMinor: ["costs"],
    },
  },
  governance_cost_rollup_restatement_index: {
    name: "governance_cost_restatements",
    description:
      "Index of cost-rollup restatements, keyed by the org's " +
      "internal_governance project; visible only to a caller whose project " +
      "set includes it.",
    grain: "one row per (TenantId, RestatementKey)",
    // `Day` is a `Date` column, not `DateTime` — defaultTimeColumn() only
    // recognizes the `DateTime` prefix, so without this override it falls
    // back to the sort key's first column (TenantId, a String), and the
    // generated example query compares TenantId to a DateTime, which
    // ClickHouse rejects (no supertype for String and DateTime).
    timeColumn: "Day",
    dedup: { versionColumn: "EventTimestamp" },
  },
  governance_kpis: {
    name: "governance_hourly_kpis",
    description:
      "Hourly spend and token KPIs per source, keyed by the org's " +
      "internal_governance project; visible only to a caller whose project " +
      "set includes it.",
    grain: "one row per (TenantId, SourceId, HourBucket, TraceId)",
    timeColumn: "HourBucket",
    dedup: { versionColumn: "LastEventOccurredAt" },
  },
  governance_ocsf_events: {
    name: "governance_security_events",
    description:
      "Raw OCSF-shaped security events, keyed by the org's " +
      "internal_governance project; visible only to a caller whose project " +
      "set includes it.",
    grain: "one row per (TenantId, EventId)",
    timeColumn: "EventTime",
    dedup: { versionColumn: "LastUpdatedAt" },
    columnGates: {
      RawOcsfJson: ["output"],
    },
  },
};
