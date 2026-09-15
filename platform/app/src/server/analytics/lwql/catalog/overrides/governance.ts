/**
 * Overrides for the governance/OCSF views (#8085 / #8116 Part B, user
 * decision: visibility is decided by the row policy, not by omission — see the
 * coordinator scope addition dropping `governance_*` from
 * {@link ../skippedTables#matchesSkipPattern}).
 *
 * Every row of these four tables is written under the org's hidden
 * `internal_governance` project (`00026_create_governance_ocsf_events.sql`),
 * never a real customer project's `TenantId` — so the standard row policy
 * already scopes them correctly: a caller only sees rows when its resolved
 * project set includes that hidden project id, which
 * `resolveLwqlReadableProjects` (`../../readableProjects.ts:115`) explicitly
 * excludes from an org API key's fan-out today. Cataloguing them costs
 * nothing extra in isolation and stops a future change to that exclusion from
 * silently widening access to an unreviewed table.
 *
 * - `governance_cost_rollup_1d` / `governance_cost_rollup_restatement_index`:
 *   per-tenant cost rollups and their restatement index. The derived
 *   classifier already gates `AmountNanoUsd`/`PreviousAmountNanoUsd` `costs`
 *   (name matches `/usd/i`); `AmountNanoMinor` does not match that pattern
 *   despite being a cost amount in minor currency units, so it is gated
 *   explicitly here. `governance_cost_rollup_restatement_index` carries no
 *   amount column (it is a restatement key index), so it needs no cost gate.
 * - `governance_kpis`: per-source hourly spend/token KPIs. `SpendUsd` already
 *   matches the default cost pattern.
 * - `governance_ocsf_events`: the raw OCSF security-event payload.
 *   `RawOcsfJson` already gates `output` by default (untyped `String`, no
 *   identifier-like name) — confirmed rather than overridden.
 */

import type { DatasetOverride } from "../defineDatasetFromTable";

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
