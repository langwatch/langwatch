package controlplane

import "github.com/langwatch/langwatch/services/aigateway/domain"

// configWire matches the JSON shape returned by GET /api/internal/gateway/config/:vk_id.
type configWire struct {
	ProjectOTLPToken string              `json:"project_otlp_token"`
	Fallback         fallbackWire        `json:"fallback"`
	ModelAliases     map[string]string   `json:"model_aliases"`
	ModelsAllowed    []string            `json:"models_allowed"`
	RateLimits       rateLimitsWire      `json:"rate_limits"`
	Guardrails       guardrailsWire      `json:"guardrails"`
	PolicyRules      policyRulesWire     `json:"policy_rules"`
	Budgets          []budgetWire        `json:"budgets"`
	CacheRules       []cacheRuleWire     `json:"cache_rules"`
}

type fallbackWire struct {
	On          []string `json:"on"`
	Chain       []string `json:"chain"`
	TimeoutMs   int      `json:"timeout_ms"`
	MaxAttempts int      `json:"max_attempts"`
}

type rateLimitsWire struct {
	RPM *int `json:"rpm"`
	TPM *int `json:"tpm"`
	RPD *int `json:"rpd"`
}

type guardrailsWire struct {
	Pre              []guardrailEntryWire `json:"pre"`
	Post             []guardrailEntryWire `json:"post"`
	StreamChunk      []guardrailEntryWire `json:"stream_chunk"`
	RequestFailOpen  bool                 `json:"request_fail_open"`
	ResponseFailOpen bool                 `json:"response_fail_open"`
}

type guardrailEntryWire struct {
	ID        string `json:"id"`
	Evaluator string `json:"evaluator"`
}

type policyRulesWire struct {
	Tools policyRuleSetWire `json:"tools"`
	MCP   policyRuleSetWire `json:"mcp"`
	URLs  policyRuleSetWire `json:"urls"`
	Models policyRuleSetWire `json:"models"`
}

type policyRuleSetWire struct {
	Deny  []string `json:"deny"`
	Allow []string `json:"allow"`
}

type budgetWire struct {
	ID            string `json:"id"`
	Scope         string `json:"scope"`
	ScopeID       string `json:"scope_id"`
	Window        string `json:"window"`
	LimitMicroUSD int64  `json:"limit_micro_usd"`
	SpentMicroUSD int64  `json:"spent_micro_usd"`
	ResetsAt      int64  `json:"resets_at"`
	OnBreach      string `json:"on_breach"`
}

type cacheRuleWire struct {
	ID       string            `json:"id"`
	Priority int               `json:"priority"`
	Matchers cacheMatchersWire `json:"matchers"`
	Action   cacheActionWire   `json:"action"`
}

type cacheMatchersWire struct {
	Model       string `json:"model"`
	PrincipalID string `json:"principal_id"`
}

type cacheActionWire struct {
	Mode string `json:"mode"`
	TTL  *int   `json:"ttl"`
}

func (w *configWire) toDomain() domain.BundleConfig {
	cfg := domain.BundleConfig{
		ProjectOTLPToken: w.ProjectOTLPToken,
		AllowedModels:    w.ModelsAllowed,
		Fallback: domain.FallbackConfig{
			MaxAttempts: w.Fallback.MaxAttempts,
			On:          w.Fallback.On,
		},
		Guardrails: domain.GuardrailsConfig{
			Pre:              mapGuardrailEntries(w.Guardrails.Pre),
			Post:             mapGuardrailEntries(w.Guardrails.Post),
			StreamChunk:      mapGuardrailEntries(w.Guardrails.StreamChunk),
			RequestFailOpen:  w.Guardrails.RequestFailOpen,
			ResponseFailOpen: w.Guardrails.ResponseFailOpen,
		},
	}

	if w.RateLimits.RPM != nil {
		cfg.RateLimits.RPM = *w.RateLimits.RPM
	}
	if w.RateLimits.RPD != nil {
		cfg.RateLimits.RPD = *w.RateLimits.RPD
	}

	if len(w.ModelAliases) > 0 {
		cfg.ModelAliases = make(map[string]domain.ModelAlias, len(w.ModelAliases))
		for alias, model := range w.ModelAliases {
			cfg.ModelAliases[alias] = domain.ModelAlias{Model: model}
		}
	}

	cfg.Budget.Scopes = make([]domain.BudgetScope, len(w.Budgets))
	for i, b := range w.Budgets {
		cfg.Budget.Scopes[i] = domain.BudgetScope{
			Scope:         b.Scope,
			Window:        b.Window,
			LimitMicroUSD: b.LimitMicroUSD,
			SpentMicroUSD: b.SpentMicroUSD,
			OnBreach:      b.OnBreach,
		}
	}

	cfg.PolicyRules = buildPolicyRules(w.PolicyRules)
	cfg.CacheRules = buildCacheRules(w.CacheRules)

	return cfg
}

func mapGuardrailEntries(entries []guardrailEntryWire) []domain.GuardrailEntry {
	out := make([]domain.GuardrailEntry, len(entries))
	for i, e := range entries {
		out[i] = domain.GuardrailEntry{ID: e.ID, Evaluator: e.Evaluator}
	}
	return out
}

func buildPolicyRules(pr policyRulesWire) []domain.PolicyRule {
	var rules []domain.PolicyRule
	for _, d := range pr.Tools.Deny {
		rules = append(rules, domain.PolicyRule{Pattern: d, Type: domain.PolicyDeny, Target: domain.PolicyTargetTool})
	}
	for _, a := range pr.Tools.Allow {
		rules = append(rules, domain.PolicyRule{Pattern: a, Type: domain.PolicyAllow, Target: domain.PolicyTargetTool})
	}
	for _, d := range pr.MCP.Deny {
		rules = append(rules, domain.PolicyRule{Pattern: d, Type: domain.PolicyDeny, Target: domain.PolicyTargetMCP})
	}
	for _, a := range pr.MCP.Allow {
		rules = append(rules, domain.PolicyRule{Pattern: a, Type: domain.PolicyAllow, Target: domain.PolicyTargetMCP})
	}
	for _, d := range pr.URLs.Deny {
		rules = append(rules, domain.PolicyRule{Pattern: d, Type: domain.PolicyDeny, Target: domain.PolicyTargetURL})
	}
	for _, a := range pr.URLs.Allow {
		rules = append(rules, domain.PolicyRule{Pattern: a, Type: domain.PolicyAllow, Target: domain.PolicyTargetURL})
	}
	return rules
}

func buildCacheRules(wires []cacheRuleWire) []domain.CacheRule {
	rules := make([]domain.CacheRule, len(wires))
	for i, w := range wires {
		var models []string
		if w.Matchers.Model != "" {
			models = []string{w.Matchers.Model}
		}
		var principals []string
		if w.Matchers.PrincipalID != "" {
			principals = []string{w.Matchers.PrincipalID}
		}
		rules[i] = domain.CacheRule{
			ID:       w.ID,
			Priority: w.Priority,
			Match: domain.CacheRuleMatch{
				Models:     models,
				Principals: principals,
			},
			Action: domain.CacheAction(w.Action.Mode),
		}
	}
	return rules
}
