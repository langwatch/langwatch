/**
 * Overrides for `log_records`, the canonical OTel log/event table (#8085 /
 * #8116 Part B, step 5).
 *
 * Exposed as `logs` — `log_records` collides with nothing else in the catalog,
 * but the shorter caller-facing name matches every other view's convention
 * of naming the thing, not the storage shape. The three aliases translate the
 * wire's OTel-correlation naming into the same `TraceId`/`SpanId`/`SessionId`
 * vocabulary every other view uses, so a caller can join `logs` to `spans`
 * or `coding_tool_results` without knowing the physical column names.
 */

import type { DatasetOverride } from "../defineDatasetFromTable";

/**
 * The five body/attribute columns carry either request or response content —
 * `EventName` (`api_request_body` vs `api_response_body`, etc.), not a
 * dedicated column, says which. Since one column can hold what another
 * view would call `input` on one row and `output` on the next, each is
 * gated as both: the derived classifier already lands `output` on every one
 * of them (each is untyped `String`/`Nullable(String)` content with no
 * identifier-like name), and the override widens that to `["input", "output"]`
 * rather than leaving a caller with only the `output` gate able to read a row
 * that is, on the wire, someone's request.
 */
const REQUEST_OR_RESPONSE_CONTENT: readonly ["input", "output"] = [
  "input",
  "output",
];

export const OBSERVABILITY_OVERRIDES: Record<
  string,
  Partial<DatasetOverride>
> = {
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
