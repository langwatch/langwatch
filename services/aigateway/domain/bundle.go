package domain

import "time"

// Bundle is the resolved virtual-key configuration used for the request lifecycle.
type Bundle struct {
	VirtualKeyID string
	ProjectID    string
	TeamID       string

	// Credentials is the ordered fallback chain of provider credentials.
	Credentials []Credential

	// Config holds the VK's policy configuration.
	Config BundleConfig

	// ExpiresAt is when this bundle's JWT expires (for cache refresh).
	ExpiresAt time.Time
}

// BundleConfig holds the policy knobs configured per virtual key.
type BundleConfig struct {
	// Credentials is the ordered fallback chain of provider credentials.
	// Populated from the config endpoint so they travel with policy config.
	Credentials []Credential

	// ModelAliases maps friendly names to canonical provider/model pairs.
	ModelAliases map[string]ModelAlias

	// AllowedModels is the allowlist. Empty = all allowed.
	AllowedModels []string

	// Fallback configures retry behavior.
	Fallback FallbackConfig

	// RateLimits configures per-VK rate limiting.
	RateLimits RateLimits

	// Budget configures spending controls.
	Budget BudgetConfig

	// Guardrails configures per-direction guardrail evaluation.
	Guardrails GuardrailsConfig

	// PolicyRules lists regex deny/allow rules.
	PolicyRules []PolicyRule

	// CacheRules lists priority-ordered cache control rules.
	CacheRules []CacheRule

	// ProjectOTLPToken is the project's auth token for AI trace export.
	ProjectOTLPToken string
}

// ModelAlias maps a friendly name to a provider + model.
type ModelAlias struct {
	ProviderID ProviderID
	Model      string
}

// FallbackConfig controls retry/fallback behavior.
type FallbackConfig struct {
	MaxAttempts int
	On          []string // trigger codes: "5xx", "timeout", "rate_limit", "network"
}

// GuardrailsConfig holds per-direction guardrail policies.
type GuardrailsConfig struct {
	Pre             []GuardrailEntry
	Post            []GuardrailEntry
	StreamChunk     []GuardrailEntry
	RequestFailOpen bool
	ResponseFailOpen bool
}

// GuardrailEntry identifies a single guardrail policy.
type GuardrailEntry struct {
	ID        string
	Evaluator string
}

// HasAny reports whether any guardrails are configured.
func (g GuardrailsConfig) HasAny() bool {
	return len(g.Pre) > 0 || len(g.Post) > 0 || len(g.StreamChunk) > 0
}

// IDs returns the guardrail IDs for the given direction.
func (g GuardrailsConfig) IDs(direction string) []string {
	var entries []GuardrailEntry
	switch direction {
	case "request", "pre":
		entries = g.Pre
	case "response", "post":
		entries = g.Post
	case "stream_chunk":
		entries = g.StreamChunk
	}
	ids := make([]string, len(entries))
	for i, e := range entries {
		ids[i] = e.ID
	}
	return ids
}

// RateLimits holds per-VK rate limit configuration.
type RateLimits struct {
	RPM int // requests per minute (0 = unlimited)
	RPD int // requests per day (0 = unlimited)
}

// BudgetConfig holds spending controls.
type BudgetConfig struct {
	Scopes []BudgetScope
}

// BudgetScope is a single budget limit with its current spend (microdollars).
type BudgetScope struct {
	Scope         string `json:"scope"`
	Window        string `json:"window"`
	LimitMicroUSD int64  `json:"limit_micro_usd"`
	SpentMicroUSD int64  `json:"spent_micro_usd"`
	OnBreach      string `json:"on_breach"` // "block" or "warn"
}

// PolicyRule is a regex-based deny/allow rule.
type PolicyRule struct {
	Pattern string
	Type    PolicyRuleType
	Target  PolicyRuleTarget
}

// PolicyRuleType is deny or allow.
type PolicyRuleType string

const (
	PolicyDeny  PolicyRuleType = "deny"
	PolicyAllow PolicyRuleType = "allow"
)

// PolicyRuleTarget specifies what the pattern matches against.
type PolicyRuleTarget string

const (
	PolicyTargetTool PolicyRuleTarget = "tool"
	PolicyTargetMCP  PolicyRuleTarget = "mcp"
	PolicyTargetURL  PolicyRuleTarget = "url"
)

// CacheRule is a priority-ordered cache control rule.
type CacheRule struct {
	ID       string
	Priority int
	Match    CacheRuleMatch
	Action   CacheAction
}

// CacheRuleMatch defines when a cache rule applies.
type CacheRuleMatch struct {
	Models     []string // glob patterns
	Principals []string
}

// CacheAction is the cache behavior to apply.
type CacheAction string

const (
	CacheActionRespect CacheAction = "respect"
	CacheActionDisable CacheAction = "disable"
	CacheActionForce   CacheAction = "force"
)
