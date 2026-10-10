/**
 * Overrides for `log_records`, the canonical OTel log/event table (#8085 / #8116 Part B, step 5).
 */

import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

export const OBSERVABILITY_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  log_records: {
    description:
      "Canonical OpenTelemetry log records: requests, responses and " +
      "provider events, correlated to their trace and span.",
    grain: "one row per (TenantId, TraceId, TimeUnixMs, RecordId)",
    timeColumn: "TimeUnixMs",
    joinKeys: ["TraceId", "SpanId"],
    dedup: { versionColumn: "DedupVersion" },
    descriptions: {
      TraceId: "Trace this log record correlates to.",
      SpanId: "Span this log record correlates to.",
      SessionId: "Provider-side session this log record belongs to.",
    },
    columnUnits: {
      TimeUnixMs: "ms",
    },
  },
  log_usage_estimates: {
    description: "Per-tenant log ingestion usage estimates.",
    timeColumn: "AcceptedAt",
    dedup: { versionColumn: "DedupVersion" },
  },
};
