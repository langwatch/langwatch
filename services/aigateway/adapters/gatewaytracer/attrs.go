package gatewaytracer

const (
	// OriginGateway is the langwatch.origin value for this service — stamped
	// on its own operational spans and, via the customer-trace policy in
	// deps.go, on the spans it retells into customer projects.
	OriginGateway = "gateway"

	AttrProjectID                 = "langwatch.project_id"
	AttrTeamID                    = "langwatch.team_id"
	AttrOrgID                     = "langwatch.organization_id"
	AttrPrincipalID               = "langwatch.principal_id"
	AttrModel                     = "langwatch.model"
	AttrProvider                  = "langwatch.provider"
	AttrModelSource               = "langwatch.model_source"
	AttrStreaming                 = "langwatch.streaming"
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
	AttrErrorType                 = "error.type"
	AttrUpstreamStatusCode        = "langwatch.upstream.status_code"
)
