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

	// Guardrails lists active guardrail policy IDs.
	Guardrails []string

	// BlockedPatterns lists regex deny/allow rules.
	BlockedPatterns []BlockedPattern

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

// RateLimits holds per-VK rate limit configuration.
type RateLimits struct {
	RPM int // requests per minute (0 = unlimited)
	RPD int // requests per day (0 = unlimited)
}

// BudgetConfig holds spending controls.
type BudgetConfig struct {
	Scopes  []BudgetScope
}

// BudgetScope is a single budget limit with its current spend.
type BudgetScope struct {
	Scope    string  `json:"scope"`
	Window   string  `json:"window"`
	LimitUSD float64 `json:"limit_usd"`
	SpentUSD float64 `json:"spent_usd"`
	OnBreach string  `json:"on_breach"` // "block" or "warn"
}

// BlockedPattern is a regex-based deny/allow rule.
type BlockedPattern struct {
	Pattern string
	Type    BlockedPatternType
	Target  BlockedPatternTarget
}

// BlockedPatternType is deny or allow.
type BlockedPatternType string

const (
	BlockedDeny  BlockedPatternType = "deny"
	BlockedAllow BlockedPatternType = "allow"
)

// BlockedPatternTarget specifies what the pattern matches against.
type BlockedPatternTarget string

const (
	BlockedTargetTool BlockedPatternTarget = "tool"
	BlockedTargetMCP  BlockedPatternTarget = "mcp"
	BlockedTargetURL  BlockedPatternTarget = "url"
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
