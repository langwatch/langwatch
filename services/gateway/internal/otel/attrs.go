// Package otel wires the gateway's OpenTelemetry story:
//
//   - W3C Trace Context propagation (incoming `traceparent` becomes the
//     parent of the gateway span, so customer traces don't double-count).
//   - A per-tenant routing exporter that reads `langwatch.project_id` off
//     the span and dispatches to a project-scoped OTLP HTTP endpoint, or
//     falls back to a single default endpoint when no per-project routing
//     is configured yet.
//   - A chi middleware that starts the gateway span before the handler
//     runs so downstream code can add attributes via
//     [SpanFromContext] and emit response headers before the body is
//     flushed.
//
// Span names follow the `lw_gateway.<verb>` convention
// (e.g. `lw_gateway.chat_completions`) so they're easy to filter in
// Tempo / Jaeger / Datadog.
package otel

// LangWatch-specific attribute keys. These are identical on the SDK side
// so any span emitted by the user's app can be joined with the gateway
// span purely on trace_id (W3C handles that) and filtered per project
// without touching OTel resource attrs.
const (
	AttrVirtualKeyID  = "langwatch.virtual_key_id"
	AttrProjectID     = "langwatch.project_id"
	AttrTeamID        = "langwatch.team_id"
	AttrOrgID         = "langwatch.organization_id"
	AttrPrincipalID   = "langwatch.principal_id"
	AttrDisplayPrefix = "langwatch.vk_display_prefix"
	AttrGatewayReqID  = "langwatch.gateway_request_id"
	AttrModel         = "langwatch.model"
	AttrProvider      = "langwatch.provider"
	AttrModelSource   = "langwatch.model_source" // alias|explicit_slash|implicit
	AttrStreaming     = "langwatch.streaming"
	AttrUsageIn       = "langwatch.usage.input_tokens"
	AttrUsageOut      = "langwatch.usage.output_tokens"
	AttrUsageCacheR   = "langwatch.usage.cache_read_tokens"
	AttrUsageCacheW   = "langwatch.usage.cache_write_tokens"
	AttrCostUSD       = "langwatch.cost_usd"
	AttrDurationMS    = "langwatch.duration_ms"
	AttrStatus        = "langwatch.status"
	AttrDecision      = "langwatch.budget.decision"
	AttrGuardrailVerdict = "langwatch.guardrail.verdict"
)

// Standard response header names the gateway emits so client SDKs /
// CLIs can stitch traces without parsing OTel payloads.
const (
	HeaderTraceID    = "X-LangWatch-Trace-Id"
	HeaderSpanID     = "X-LangWatch-Span-Id"
	HeaderTraceparent = "traceparent"
)
