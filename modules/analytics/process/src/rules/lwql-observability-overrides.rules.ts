/**
 * Overrides for `log_records`, the canonical OTel log/event table (#8085 / #8116 Part B, step 5).
 */

import type { DatasetOverride } from "./lwql-dataset-derivation.rules.ts";

/**
 * The five body/attribute columns carry either request or response content — `EventName`
 * (`api_request_body` vs `api_response_body`, etc.), not a dedicated column, says which.
 */
const REQUEST_OR_RESPONSE_CONTENT: readonly ["input", "output"] = ["input", "output"];

export const OBSERVABILITY_OVERRIDES: Record<string, Partial<DatasetOverride>> = {
  log_records: {
    name: "logs",
    description:
      "Canonical OpenTelemetry log records: requests, responses and " +
      "provider events, correlated to their trace and span.",
    grain: "one row per (TenantId, TraceId, TimeUnixMs, RecordId)",
    timeColumn: "TimeUnixMs",
    joinKeys: ["TraceId", "SpanId"],
    dedup: { versionColumn: "DedupVersion" },
    aliases: {
      TraceId: "CorrelationTraceId",
      SpanId: "CorrelationSpanId",
      SessionId: "ProviderSessionId",
    },
    descriptions: {
      TraceId: "Trace this log record correlates to.",
      SpanId: "Span this log record correlates to.",
      SessionId: "Provider-side session this log record belongs to.",
    },
    columnUnits: {
      TimeUnixMs: "ms",
    },
    columnGates: {
      BodyText: REQUEST_OR_RESPONSE_CONTENT,
      BodyJson: REQUEST_OR_RESPONSE_CONTENT,
      AttributesJson: REQUEST_OR_RESPONSE_CONTENT,
      AttributesFlatJson: REQUEST_OR_RESPONSE_CONTENT,
      CanonicalPayload: REQUEST_OR_RESPONSE_CONTENT,
    },
  },
  log_usage_estimates: {
    name: "log_ingestion_usage",
    description: "Per-tenant log ingestion usage estimates.",
    timeColumn: "AcceptedAt",
    dedup: { versionColumn: "DedupVersion" },
  },
};
