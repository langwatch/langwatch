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
	// AttrOrigin tags every gateway-emitted span so LangWatch trace
	// pipeline can sort them into the "Gateway" origin bucket alongside
	// application / evaluation / simulation / playground. Value is the
	// constant OriginGateway below; see trace-origin.service.ts on the
	// control plane for the canonical list.
	AttrOrigin        = "langwatch.origin"
	OriginGateway     = "gateway"
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
	// Usage counters use the OTel GenAI semconv per rchaves's
	// "OTEL semconv all the way" direction — the LangWatch trace
	// canonicaliser (langwatch/src/server/app-layer/traces/
	// canonicalisation/extractors/genAi.ts §227-243) reads exactly
	// these keys, and every OTEL-compliant viewer (Tempo / Jaeger /
	// Datadog / Grafana) surfaces them natively. Using
	// langwatch.usage.* meant the LangWatch inbox rendered 0 tokens
	// / $0 cost (rchaves iter 107 dogfood #1b).
	AttrUsageIn                       = "gen_ai.usage.input_tokens"
	AttrUsageOut                      = "gen_ai.usage.output_tokens"
	AttrUsageCacheReadInputTokens     = "gen_ai.usage.cache_read.input_tokens"
	AttrUsageCacheCreationInputTokens = "gen_ai.usage.cache_creation.input_tokens"
	// GenAI request / response + message attributes (OTel semconv).
	// The LangWatch canonicaliser hoists these into the trace's
	// input / output / token / metadata columns; every gateway span
	// should carry the full set rchaves specified ("EVERYTHING
	// should follow the gen_ai specs"). Keys are the source of truth
	// in langwatch/src/server/app-layer/traces/canonicalisation/
	// extractors/_constants.ts — drop-and-rename is safe because
	// both sides read the same constant file at lint time.
	AttrGenAIOperationName    = "gen_ai.operation.name"
	AttrGenAISystem           = "gen_ai.system"
	AttrGenAIRequestModel     = "gen_ai.request.model"
	AttrGenAIRequestTemperature = "gen_ai.request.temperature"
	AttrGenAIRequestMaxTokens = "gen_ai.request.max_tokens"
	AttrGenAIRequestTopP      = "gen_ai.request.top_p"
	AttrGenAIRequestFreqPenalty = "gen_ai.request.frequency_penalty"
	AttrGenAIRequestPresPenalty = "gen_ai.request.presence_penalty"
	AttrGenAIRequestStopSeqs  = "gen_ai.request.stop_sequences"
	AttrGenAIResponseID       = "gen_ai.response.id"
	AttrGenAIResponseModel    = "gen_ai.response.model"
	AttrGenAIResponseFinishReasons = "gen_ai.response.finish_reasons"
	AttrGenAIInputMessages    = "gen_ai.input.messages"
	AttrGenAIOutputMessages   = "gen_ai.output.messages"
	AttrGenAISystemInstructions = "gen_ai.system_instructions"
	AttrGenAIUsageTotalTokens = "gen_ai.usage.total_tokens"
	AttrCostUSD       = "langwatch.cost_usd"
	AttrDurationMS    = "langwatch.duration_ms"
	AttrStatus        = "langwatch.status"
	AttrDecision      = "langwatch.budget.decision"
	AttrGuardrailVerdict = "langwatch.guardrail.verdict"
	// Cache-control rule match attribution. Emitted when the bundle-
	// baked rule engine (internal/cacherules) picks a matching rule
	// ahead of the per-request X-LangWatch-Cache header. rule_id is
	// the configured rule identifier; rule_priority mirrors the
	// control-plane-assigned priority (DESC-sorted on the wire);
	// mode_applied is the final mode after header-vs-rule-vs-default
	// precedence resolution (contract §Precedence).
	AttrCacheRuleID       = "langwatch.cache.rule_id"
	AttrCacheRulePriority = "langwatch.cache.rule_priority"
	AttrCacheModeApplied  = "langwatch.cache.mode_applied"
	// Fallback-chain attribution. attempts_count mirrors the older
	// langwatch.fallback.attempts key (kept around for back-compat on
	// dashboards / queries), winning_provider lets operators see
	// which credential actually produced the response without
	// walking the full span events list. Contract defined in
	// specs/ai-gateway/span-shape.feature §6.
	AttrFallbackAttemptsCount = "langwatch.fallback.attempts_count"
	AttrFallbackWinningProvider = "langwatch.fallback.winning_provider"
	AttrFallbackWinningCredential = "langwatch.fallback.winning_credential"
)

// Standard response header names the gateway emits so client SDKs /
// CLIs can stitch traces without parsing OTel payloads.
const (
	HeaderTraceID    = "X-LangWatch-Trace-Id"
	HeaderSpanID     = "X-LangWatch-Span-Id"
	HeaderTraceparent = "traceparent"
)

// Client-facing request headers the gateway reads to enrich the span
// without requiring a per-user VK. Useful when a single VK fronts
// multi-user traffic (a chat UI, a coding assistant shared across a
// team): callers stamp X-LangWatch-Principal per-request and analytics
// can slice by end user without minting a VK per user.
const (
	// HeaderPrincipal overrides AttrPrincipalID when set. Must match
	// existing LangWatch principal id format (e.g. user_XXXXXXXXXX) —
	// the control-plane trace pipeline treats it as an opaque string.
	HeaderPrincipal = "X-LangWatch-Principal"
	// HeaderThreadID stamps langwatch.thread_id so gateway spans from
	// the same conversation can be grouped. Mirrors the SDK-side
	// convention.
	HeaderThreadID = "X-LangWatch-Thread-Id"

	// AttrThreadID — matches the canonicaliser's extraction key.
	AttrThreadID = "langwatch.thread_id"
)
