/** Every ClickHouse domain override, merged into the single map the explicit catalog reads. */

import { AUDIT_OVERRIDES } from "./lwql-audit-overrides.rules.ts";
import { CODING_OVERRIDES } from "./lwql-coding-overrides.rules.ts";
import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";
import { EXPERIMENTS_OVERRIDES } from "./lwql-experiments-overrides.rules.ts";
import { GATEWAY_OVERRIDES } from "./lwql-gateway-overrides.rules.ts";
import { GOVERNANCE_OVERRIDES } from "./lwql-governance-overrides.rules.ts";
import { LEGACY_OVERRIDES } from "./lwql-legacy-overrides.rules.ts";
import { METRICS_OVERRIDES } from "./lwql-metrics-overrides.rules.ts";
import { OBSERVABILITY_OVERRIDES } from "./lwql-observability-overrides.rules.ts";

/** Overrides for the Langy in-product agent's own tables (#8085 / #8116 Part B, step 5). */

const LANGY_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  langy_messages: {
    description: "Langy conversation turns, one row per message.",
    grain: "one row per (TenantId, ConversationId, MessageId)",
    timeColumn: "CreatedAt",
    dedup: { versionColumn: "UpdatedAt" },
  },
  langy_analytics_events: {
    description: "Langy usage telemetry: tool calls, outcomes and durations.",
    grain: "one row per (TenantId, OccurredAt, EventId)",
    timeColumn: "OccurredAt",
    dedup: { versionColumn: "ProjectedAt" },
    columnUnits: {
      DurationMs: "ms",
    },
  },
};

export const CLICKHOUSE_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  ...OBSERVABILITY_OVERRIDES,
  ...LANGY_OVERRIDES,
  ...CODING_OVERRIDES,
  ...EXPERIMENTS_OVERRIDES,
  ...METRICS_OVERRIDES,
  ...GATEWAY_OVERRIDES,
  ...AUDIT_OVERRIDES,
  ...LEGACY_OVERRIDES,
  ...GOVERNANCE_OVERRIDES,
};
