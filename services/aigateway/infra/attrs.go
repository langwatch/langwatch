// Package infra holds infrastructure concerns for the AI Gateway:
// telemetry, metrics, and control plane clients.
package infra

// Attribute keys for gateway operational spans (our observability).
const (
	AttrOrigin                    = "langwatch.origin"
	OriginGateway                 = "gateway"
	AttrVirtualKeyID              = "langwatch.virtual_key_id"
	AttrProjectID                 = "langwatch.project_id"
	AttrTeamID                    = "langwatch.team_id"
	AttrOrgID                     = "langwatch.organization_id"
	AttrPrincipalID               = "langwatch.principal_id"
	AttrGatewayReqID              = "langwatch.gateway_request_id"
	AttrModel                     = "langwatch.model"
	AttrProvider                  = "langwatch.provider"
	AttrModelSource               = "langwatch.model_source"
	AttrStreaming                  = "langwatch.streaming"
	AttrCostUSD                   = "langwatch.cost_usd"
	AttrDurationMS                = "langwatch.duration_ms"
	AttrStatus                    = "langwatch.status"
	AttrDecision                  = "langwatch.budget.decision"
	AttrGuardrailVerdict          = "langwatch.guardrail.verdict"
	AttrCacheRuleID               = "langwatch.cache.rule_id"
	AttrCacheRulePriority         = "langwatch.cache.rule_priority"
	AttrCacheModeApplied          = "langwatch.cache.mode_applied"
	AttrFallbackAttemptsCount     = "langwatch.fallback.attempts_count"
	AttrFallbackWinningProvider   = "langwatch.fallback.winning_provider"
	AttrFallbackWinningCredential = "langwatch.fallback.winning_credential"
	AttrThreadID                  = "langwatch.thread_id"
)

// GenAI semantic convention attributes (for customer AI traces).
const (
	AttrGenAIOperationName     = "gen_ai.operation.name"
	AttrGenAISystem            = "gen_ai.system"
	AttrGenAIRequestModel      = "gen_ai.request.model"
	AttrGenAIRequestTemp       = "gen_ai.request.temperature"
	AttrGenAIRequestMaxTokens  = "gen_ai.request.max_tokens"
	AttrGenAIRequestTopP       = "gen_ai.request.top_p"
	AttrGenAIRequestFreqPen    = "gen_ai.request.frequency_penalty"
	AttrGenAIRequestPresPen    = "gen_ai.request.presence_penalty"
	AttrGenAIRequestStopSeqs   = "gen_ai.request.stop_sequences"
	AttrGenAIResponseID        = "gen_ai.response.id"
	AttrGenAIResponseModel     = "gen_ai.response.model"
	AttrGenAIResponseFinish    = "gen_ai.response.finish_reasons"
	AttrGenAIInputMessages     = "gen_ai.input.messages"
	AttrGenAIOutputMessages    = "gen_ai.output.messages"
	AttrGenAISystemInstructions = "gen_ai.system_instructions"
	AttrGenAIUsageIn           = "gen_ai.usage.input_tokens"
	AttrGenAIUsageOut          = "gen_ai.usage.output_tokens"
	AttrGenAIUsageTotal        = "gen_ai.usage.total_tokens"
	AttrGenAIUsageCacheRead    = "gen_ai.usage.cache_read.input_tokens"
	AttrGenAIUsageCacheCreate  = "gen_ai.usage.cache_creation.input_tokens"
)

// Response headers emitted by the gateway.
const (
	HeaderTraceID     = "X-LangWatch-Trace-Id"
	HeaderSpanID      = "X-LangWatch-Span-Id"
	HeaderPrincipal   = "X-LangWatch-Principal"
	HeaderThreadID    = "X-LangWatch-Thread-Id"
)
