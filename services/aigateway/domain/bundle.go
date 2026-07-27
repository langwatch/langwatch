package domain

import (
	"slices"
	"strings"
	"time"
)

// Bundle is the resolved virtual-key configuration used for the request lifecycle.
type Bundle struct {
	VirtualKeyID   string
	ProjectID      string
	TeamID         string
	OrganizationID string

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

	// TraceProjectID is the project customer traces are EXPORTED to. It is NOT
	// necessarily the VK's own project: resolveTraceProject (control plane) falls
	// back to the organization's internal_governance project whenever the VK is
	// not scoped to exactly one project, so this can name a different project on
	// a different team than Bundle.ProjectID.
	//
	// It is materialized in the SAME config payload as ProjectOTLPToken, so the
	// two always describe one project. Pair the token with THIS field and never
	// with Bundle.ProjectID: that one is carried on the auth JWT, refreshed on a
	// different clock, and a skew between the two clocks exports one project's
	// prompts and completions under another project's ingest token.
	TraceProjectID string

	// ProjectOTLPToken is the auth token for AI trace export into TraceProjectID.
	ProjectOTLPToken string

	// MirrorTier is the ADR-061 mirror fidelity resolved for this VK's
	// organization ("content" | "structural" | "skip" | ""). Non-skip only for
	// Langy virtual keys — the control-plane materialiser leaves it empty for
	// ordinary customer VKs, so their gen_ai spans are never mirrored. When
	// non-skip, the customer trace bridge emits a SECOND gen_ai span into the
	// mirror project at the tier's fidelity (see pkg/customertracebridge).
	MirrorTier string

	// VKDisplayPrefix is the VK's public display prefix (e.g. "vk-lw-…").
	// Carried so rule matchers can target VKs by prefix without leaking the
	// secret. Sourced from the control-plane config payload.
	VKDisplayPrefix string

	// VKTags carries the VK's operator-assigned tags (config.metadata.tags
	// on the control plane). Consumed by cache rule matchers (vk_tags) and
	// stamped on customer spans as langwatch.labels so the Trace Explorer
	// can filter gateway traffic by tag.
	VKTags []string

	// ProvidersAllowed is the key's explicit provider allowlist, as
	// ModelProvider row ids (the same ids Credentials carry). Empty means
	// every provider in the bundle: that is what the control plane sends for
	// "All providers" keys, whose bundles already contain only eligible
	// providers. A non-empty list is enforced at dispatch too, so a stale or
	// hand-crafted credential chain cannot reach a provider the key was
	// narrowed away from. Contract §4.2 providers_allowed.
	ProvidersAllowed []string

	// RoutingMode is how the key behaves when its provider fails: no
	// failover, walk every eligible provider, or follow a routing policy.
	// Enforcement rides Fallback.MaxAttempts (pinned to 1 for
	// RoutingModeNone by the control plane AND at wire decode, so a drifted
	// control plane cannot silently re-arm fallback on a no-fallback key).
	RoutingMode string
}

// Routing modes carried on the bundle wire (contract §4.2 routing_mode).
const (
	RoutingModeNone        = "none"
	RoutingModeFallbackAll = "fallback_all"
	RoutingModePolicy      = "policy"
)

// AllowsProvider reports whether a ModelProvider row id is inside the key's
// provider allowlist. An empty allowlist allows every provider (the "All
// providers, current and future" persistence per contract §4.2).
func (c BundleConfig) AllowsProvider(id string) bool {
	if len(c.ProvidersAllowed) == 0 {
		return true
	}
	return slices.Contains(c.ProvidersAllowed, id)
}

// AllowsModel reports whether a model ID satisfies models_allowed. An
// empty allowlist allows everything. Entries are either a literal model
// ID or a trailing-"*" prefix pattern.
func (c BundleConfig) AllowsModel(model string) bool {
	if len(c.AllowedModels) == 0 {
		return true
	}
	for _, pattern := range c.AllowedModels {
		if ModelPatternMatches(pattern, model) {
			return true
		}
	}
	return false
}

// ModelPatternMatches applies one models_allowed entry to a model ID.
func ModelPatternMatches(pattern, model string) bool {
	if pattern == model {
		return true
	}
	if ModelPatternIsWildcard(pattern) {
		return strings.HasPrefix(model, strings.TrimSuffix(pattern, "*"))
	}
	return false
}

// ModelPatternIsWildcard reports whether a models_allowed entry is a
// pattern rather than a concrete model ID. Callers that surface the
// allowlist to users (GET /v1/models) must not present a wildcard as if
// it were a model a client can request.
func ModelPatternIsWildcard(pattern string) bool {
	return strings.HasSuffix(pattern, "*")
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
	Pre              []GuardrailEntry
	Post             []GuardrailEntry
	StreamChunk      []GuardrailEntry
	RequestFailOpen  bool
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
	// ID is the control-plane GatewayBudget row id, carried so a block can
	// name the budget that caused it.
	ID    string `json:"id"`
	Scope string `json:"scope"`
	// ScopeID is the bucket spend accumulates under. Equal to the budget's
	// target for every scope except "group", where it is "<groupId>:<userId>"
	// so each group member gets their own allowance; provider-filtered
	// budgets additionally suffix "|provider:<modelProviderId>". The control
	// plane computes it; the gateway only reports it back.
	ScopeID string `json:"scope_id"`
	// PrincipalID names the member a "group" bucket belongs to. Empty for
	// every other scope.
	PrincipalID string `json:"principal_id"`
	// ProviderKey is the ModelProvider row id this budget is filtered to.
	// Empty means the budget counts and constrains every dispatch; set means
	// it counts only dispatches to that provider, so a breach removes the
	// provider from the candidate chain instead of blocking the request.
	ProviderKey   string `json:"provider_key"`
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
	PolicyTargetTool  PolicyRuleTarget = "tool"
	PolicyTargetMCP   PolicyRuleTarget = "mcp"
	PolicyTargetURL   PolicyRuleTarget = "url"
	PolicyTargetModel PolicyRuleTarget = "model"
)

// CacheRule is a priority-ordered cache control rule.
type CacheRule struct {
	ID       string
	Priority int
	Match    CacheRuleMatch
	Action   CacheAction
}

// CacheRuleMatch defines when a cache rule applies. All non-empty matchers
// must match for the rule to fire (AND semantics). An empty match struct
// matches every request — kept as a deliberate operator-friendly default.
//
// Matchers added later (e.g. request_metadata) belong here; missing matcher
// data on the bundle/request must be treated as "doesn't match" so wiring
// gaps fail safe (don't accidentally apply rules to traffic the operator
// didn't intend).
type CacheRuleMatch struct {
	Models     []string // glob patterns
	Principals []string
	VKIDs      []string
	VKPrefixes []string
	VKTags     []string
}

// CacheEvalContext bundles the per-request and per-VK signals that cache
// rule matchers can target. Lives in domain/ so app/ and app/pipeline/
// both reference one canonical type — keeps the evaluator interface and
// the pipeline interceptor in lockstep.
type CacheEvalContext struct {
	Model           string
	VKID            string
	VKDisplayPrefix string
	VKTags          []string
	PrincipalID     string
}

// CacheAction is the cache behavior to apply.
type CacheAction string

const (
	CacheActionRespect CacheAction = "respect"
	CacheActionDisable CacheAction = "disable"
	CacheActionForce   CacheAction = "force"
)
