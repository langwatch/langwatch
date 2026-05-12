package controlplane

import "github.com/langwatch/langwatch/services/aigateway/domain"

// configWire matches the JSON shape returned by GET /api/internal/gateway/config/:vk_id.
type configWire struct {
	ProjectOTLPToken string             `json:"project_otlp_token"`
	DisplayPrefix    string             `json:"display_prefix"`
	Providers        []providerSlotWire `json:"providers"`
	Fallback         fallbackWire       `json:"fallback"`
	ModelAliases     map[string]string  `json:"model_aliases"`
	ModelsAllowed    []string           `json:"models_allowed"`
	RateLimits       rateLimitsWire     `json:"rate_limits"`
	Guardrails       guardrailsWire     `json:"guardrails"`
	PolicyRules      policyRulesWire    `json:"policy_rules"`
	Budgets          []budgetWire       `json:"budgets"`
	CacheRules       []cacheRuleWire    `json:"cache_rules"`
}

type providerSlotWire struct {
	ID          string                 `json:"id"`
	Type        string                 `json:"type"`
	Credentials map[string]interface{} `json:"credentials"`
	// DeploymentMap maps public model ids to provider-native deployment
	// names (Azure routes on deployment, Bedrock on inference profile,
	// etc.). Emitted by the control-plane materialiser as a top-level
	// sibling of credentials — see config.materialiser.ts:buildProviderSlot.
	DeploymentMap map[string]string `json:"deployment_map,omitempty"`
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
	Tools  policyRuleSetWire `json:"tools"`
	MCP    policyRuleSetWire `json:"mcp"`
	URLs   policyRuleSetWire `json:"urls"`
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

// cacheMatchersWire mirrors the matchers shape emitted by the control-plane
// materialiser (langwatch/src/server/gateway/config.materialiser.ts:121-128).
// Every recognized matcher must have an explicit field — silently dropping a
// matcher at unmarshal collapses the rule's effective scope to "match all"
// and was the iter-110 root cause of the matrix anthropic/bedrock cache cells
// returning cache_creation=0 / cache_read=0 (the seed's `disable-cache-evals`
// rule, gated on `vk_prefix=lw_vk_eval_`, fell through to matching every VK
// including matrix-* ones, stripping `cache_control` from the system block).
type cacheMatchersWire struct {
	Model           string            `json:"model"`
	PrincipalID     string            `json:"principal_id"`
	VKID            string            `json:"vk_id"`
	VKPrefix        string            `json:"vk_prefix"`
	VKTags          []string          `json:"vk_tags"`
	RequestMetadata map[string]string `json:"request_metadata"`
}

type cacheActionWire struct {
	Mode string `json:"mode"`
	TTL  *int   `json:"ttl"`
}

func (w *configWire) toDomain() domain.BundleConfig {
	creds := make([]domain.Credential, 0, len(w.Providers))
	for _, p := range w.Providers {
		creds = append(creds, providerSlotToCredential(p))
	}

	cfg := domain.BundleConfig{
		Credentials:      creds,
		ProjectOTLPToken: w.ProjectOTLPToken,
		VKDisplayPrefix:  w.DisplayPrefix,
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
	for i := range wires {
		w := &wires[i]
		var models []string
		if w.Matchers.Model != "" {
			models = []string{w.Matchers.Model}
		}
		var principals []string
		if w.Matchers.PrincipalID != "" {
			principals = []string{w.Matchers.PrincipalID}
		}
		var vkIDs []string
		if w.Matchers.VKID != "" {
			vkIDs = []string{w.Matchers.VKID}
		}
		var vkPrefixes []string
		if w.Matchers.VKPrefix != "" {
			vkPrefixes = []string{w.Matchers.VKPrefix}
		}
		// request_metadata is intentionally not yet evaluated end-to-end
		// (the gateway doesn't surface the inbound request headers to the
		// cache evaluator yet). Until that wiring lands, a rule that
		// depends on request_metadata must not silently match every VK —
		// route it through the same fail-safe as VKTags by collapsing it
		// into a never-matchable VKTag sentinel. Drops the rule instead
		// of misapplying it.
		vkTags := w.Matchers.VKTags
		if len(w.Matchers.RequestMetadata) > 0 {
			vkTags = append(vkTags, "__unsupported_matcher_request_metadata__")
		}
		rules[i] = domain.CacheRule{
			ID:       w.ID,
			Priority: w.Priority,
			Match: domain.CacheRuleMatch{
				Models:     models,
				Principals: principals,
				VKIDs:      vkIDs,
				VKPrefixes: vkPrefixes,
				VKTags:     vkTags,
			},
			Action: domain.CacheAction(w.Action.Mode),
		}
	}
	return rules
}

func providerSlotToCredential(p providerSlotWire) domain.Credential {
	cred := domain.Credential{
		ID:         p.ID,
		ProviderID: normalizeProviderType(p.Type),
	}

	getString := func(key string) string {
		if v, ok := p.Credentials[key]; ok {
			if s, ok := v.(string); ok {
				return s
			}
		}
		return ""
	}

	// deployment_map is a top-level sibling of credentials on the wire
	// (materialiser emits it at ProviderSlot.deployment_map when the
	// ModelProvider has a non-empty deploymentMapping). Providers that
	// don't use deployment routing get nil here and ignore it.
	if len(p.DeploymentMap) > 0 {
		cred.DeploymentMap = p.DeploymentMap
	}

	switch cred.ProviderID {
	case domain.ProviderAzure:
		cred.APIKey = getString("api_key")
		cred.Extra = map[string]string{
			"endpoint":    getString("endpoint"),
			"api_version": getString("api_version"),
		}
	case domain.ProviderBedrock:
		cred.Extra = map[string]string{
			"access_key":    getString("access_key"),
			"secret_key":    getString("secret_key"),
			"session_token": getString("session_token"),
			"region":        getString("region"),
		}
	case domain.ProviderVertex:
		cred.Extra = map[string]string{
			"project_id":       getString("project_id"),
			"project_number":   getString("project_number"),
			"region":           getString("region"),
			"auth_credentials": getString("auth_credentials"),
		}
	default:
		cred.APIKey = getString("api_key")
	}

	return cred
}

func normalizeProviderType(t string) domain.ProviderID {
	switch t {
	case "azure":
		return domain.ProviderAzure
	case "bedrock", "aws_bedrock":
		return domain.ProviderBedrock
	case "vertex", "vertex_ai", "google_vertex":
		return domain.ProviderVertex
	case "gemini", "google_gemini":
		return domain.ProviderGemini
	case "anthropic":
		return domain.ProviderAnthropic
	case "openai":
		return domain.ProviderOpenAI
	default:
		return domain.ProviderID(t)
	}
}
