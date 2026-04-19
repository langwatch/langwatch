// Package auth resolves a virtual-key bearer token into a JWT + config bundle
// via the LangWatch control plane. Three-tier cache: in-memory LRU (L1) +
// Redis (L2) + background refresh + optional bootstrap-all-keys warm.
package auth

import (
	"encoding/json"
	"time"
)

// JWT is the hot-path auth proof. Verified on every request; carries only
// identity, not config. See specs/ai-gateway/_shared/contract.md.
type JWTClaims struct {
	VirtualKeyID   string `json:"vk_id"`
	ProjectID      string `json:"project_id"`
	TeamID         string `json:"team_id"`
	OrganizationID string `json:"org_id"`
	PrincipalID    string `json:"principal_id"`
	Revision       int64  `json:"revision"`
	ExpiresAt      int64  `json:"exp"`
	IssuedAt       int64  `json:"iat"`
	Issuer         string `json:"iss,omitempty"`
	Audience       string `json:"aud,omitempty"`
	// Convenience for jwt/v5 Subject; same as VirtualKeyID.
	Subject string `json:"sub,omitempty"`
}

// Config is the warm-path bundle — rich, cached, refreshed by revision.
// Loaded from GET /internal/gateway/config/:vk_id with If-None-Match.
type Config struct {
	VirtualKeyID   string                   `json:"vk_id"`
	Revision       int64                    `json:"revision"`
	ProviderCreds  []ProviderCred           `json:"providers"`
	Fallback       FallbackSpec             `json:"fallback"`
	// ObservabilityEndpoint is an optional per-project OTLP HTTP endpoint
	// that the gateway sends its spans to. When null, the gateway falls
	// back to GATEWAY_OTEL_DEFAULT_ENDPOINT (the shared LangWatch
	// collector for hosted customers, or the self-hosted collector for
	// on-prem). Populated by contrast-side config.materialiser iter 6.
	ObservabilityEndpoint string `json:"observability_endpoint,omitempty"`
	ModelAliases   map[string]string        `json:"model_aliases"`
	Cache          CacheConfig              `json:"cache"`
	Guardrails     GuardrailConfig          `json:"guardrails"`
	BlockedPatterns BlockedPatternConfig    `json:"blocked_patterns"`
	// ModelsAllowed is the glob allowlist of models the VK may
	// target (e.g. "gpt-5-mini", "claude-haiku-*"). Empty = no
	// allowlist (all provider-supported models pass). Separate from
	// BlockedPatterns.Models which is a regex-based deny/allow on
	// model strings for stricter policies.
	ModelsAllowed   []string                 `json:"models_allowed"`
	RateLimits     RateLimitConfig          `json:"rate_limits"`
	Budgets        []BudgetSpec             `json:"budgets"`
	Permissions    []string                 `json:"permissions"`
	FetchedAt      time.Time                `json:"-"`
}

type ProviderCred struct {
	ID          string          `json:"id"`
	Type        string          `json:"type"`
	Credentials json.RawMessage `json:"credentials"`
	BaseURL     string          `json:"base_url,omitempty"`
	Region      string          `json:"region,omitempty"`
	DeploymentMap map[string]string `json:"deployment_map,omitempty"`
}

// FallbackSpec mirrors contract §4.2 `fallback`:
//
//	{ "on": ["5xx","timeout","rate_limit_exceeded","network"],
//	  "chain": ["pc_primary","pc_secondary"],
//	  "timeout_ms": 30000,
//	  "max_attempts": 3 }
type FallbackSpec struct {
	On          []string `json:"on"`
	Chain       []string `json:"chain"` // ordered list of provider_credential IDs
	TimeoutMS   int      `json:"timeout_ms"`
	MaxAttempts int      `json:"max_attempts"`
}

type CacheConfig struct {
	Mode string `json:"mode"` // respect|force|disable
	TTLS int    `json:"ttl_s,omitempty"`
}

type GuardrailConfig struct {
	Pre    []string `json:"pre"`
	Post   []string `json:"post"`
	Stream []string `json:"stream_chunk"`
}

// BlockedPatternConfig mirrors contract §4.2 / §5 `blocked_patterns`.
// Each dimension has independent deny and allow lists; allow=nil means
// "no allowlist" (only deny applies), allow=[] means "nothing
// allowed" (every call blocks).
type BlockedPatternConfig struct {
	Tools  BlockedPattern `json:"tools"`
	MCPs   BlockedPattern `json:"mcp"`
	URLs   BlockedPattern `json:"urls"`
	Models BlockedPattern `json:"models"`
}

// BlockedPattern is one deny/allow pair. Regex strings are
// RE2-compatible; see internal/blocked.
type BlockedPattern struct {
	Deny  []string `json:"deny"`
	Allow []string `json:"allow"` // nil = no allowlist
}

type RateLimitConfig struct {
	RPM int `json:"rpm,omitempty"`
	TPM int `json:"tpm,omitempty"`
	RPD int `json:"rpd,omitempty"`
}

type BudgetSpec struct {
	Scope     string  `json:"scope"` // org|team|project|virtual_key|principal
	ScopeID   string  `json:"scope_id"`
	Window    string  `json:"window"` // minute|hour|day|week|month|total
	LimitUSD  float64 `json:"limit_usd"`
	SpentUSD  float64 `json:"spent_usd"`
	ResetsAt  int64   `json:"resets_at"`
	OnBreach  string  `json:"on_breach"` // block|warn
}

// Bundle is what the cache returns — JWT + Config together, with expiry.
// Config may be nil immediately after resolve-key (it's a separate GET); the
// cache fills it lazily on first request or eagerly via the refresh loop.
type Bundle struct {
	JWT           string    `json:"jwt"`
	JWTClaims     JWTClaims `json:"claims"`
	Config        *Config   `json:"config"`
	JWTExpiresAt  time.Time `json:"expires_at"`
	ResolvedAt    time.Time `json:"resolved_at"`
	DisplayPrefix string    `json:"display_prefix"`
	// BlockedPatterns is compiled lazily by callers that enforce
	// blocked-pattern policy (regex compile is too expensive for the
	// hot path; compile once per bundle revision). Type is `any` to
	// avoid a cycle from auth → blocked. Never serialized — receiving
	// pods recompile on first use.
	BlockedPatterns any `json:"-"`
}

// Expired reports whether the JWT is past its exp.
func (b *Bundle) Expired() bool {
	return time.Now().After(b.JWTExpiresAt)
}

// Getters expose the JWT-claim fields as no-arg methods so packages
// that can't import auth directly (to avoid cycles) can still read
// them via an interface. See otel.BundleLike.
func (b *Bundle) VirtualKeyID() string    { return b.JWTClaims.VirtualKeyID }
func (b *Bundle) ProjectID() string       { return b.JWTClaims.ProjectID }
func (b *Bundle) TeamID() string          { return b.JWTClaims.TeamID }
func (b *Bundle) OrganizationID() string  { return b.JWTClaims.OrganizationID }
func (b *Bundle) PrincipalID() string     { return b.JWTClaims.PrincipalID }
func (b *Bundle) DisplayPrefixStr() string { return b.DisplayPrefix }

// NeedsRefresh reports whether the bundle should be proactively refreshed
// (default: within 5 minutes of expiry).
func (b *Bundle) NeedsRefresh(threshold time.Duration) bool {
	return time.Until(b.JWTExpiresAt) < threshold
}
