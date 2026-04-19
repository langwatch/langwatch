// Package auth resolves a virtual-key bearer token into a JWT + config bundle
// via the LangWatch control plane. Three-tier cache: in-memory LRU (L1) +
// Redis (L2) + background refresh + optional bootstrap-all-keys warm.
package auth

import (
	"encoding/json"
	"fmt"
	"strconv"
	"time"
)

// BigInt64 is int64 on the Go side but accepts either a JSON number
// or a numeric JSON string on the wire. The control plane serializes
// Prisma BigInt columns (VirtualKey.revision, GatewayChangeEvent.id,
// …) as strings to survive the JSON safe-integer range; older iters
// emitted them as numbers for small values. Types that mirror those
// columns should use BigInt64 instead of raw int64 so both shapes
// decode cleanly.
type BigInt64 int64

func (b *BigInt64) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	var n int64
	if err := json.Unmarshal(data, &n); err == nil {
		*b = BigInt64(n)
		return nil
	}
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return fmt.Errorf("bigint: not number or numeric string: %w", err)
	}
	if s == "" {
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return fmt.Errorf("bigint: %q is not a valid int64: %w", s, err)
	}
	*b = BigInt64(v)
	return nil
}

func (b BigInt64) MarshalJSON() ([]byte, error) {
	return []byte(strconv.FormatInt(int64(b), 10)), nil
}

// JWT is the hot-path auth proof. Verified on every request; carries only
// identity, not config. See specs/ai-gateway/_shared/contract.md.
type JWTClaims struct {
	VirtualKeyID   string `json:"vk_id"`
	ProjectID      string `json:"project_id"`
	TeamID         string `json:"team_id"`
	OrganizationID string `json:"org_id"`
	PrincipalID    string `json:"principal_id"`
	// Revision is the VK row's BigInt revision counter. The control
	// plane signs it as a JSON string (BigInt safely round-trips JSON
	// only as string), so UnmarshalJSON below accepts either a number
	// or a numeric string. Go-side math on revisions uses int64.
	Revision       int64  `json:"revision"`
	ExpiresAt      int64  `json:"exp"`
	IssuedAt       int64  `json:"iat"`
	Issuer         string `json:"iss,omitempty"`
	Audience       string `json:"aud,omitempty"`
	// Convenience for jwt/v5 Subject; same as VirtualKeyID.
	Subject string `json:"sub,omitempty"`
}

// UnmarshalJSON tolerates `revision` as a JSON string (control-plane
// emit format, BigInt-safe) or a JSON number (earlier iters; kept for
// backward compat during rollout). All other fields use the default
// unmarshal path.
func (c *JWTClaims) UnmarshalJSON(data []byte) error {
	type plain JWTClaims
	aux := struct {
		Revision json.RawMessage `json:"revision"`
		*plain
	}{plain: (*plain)(c)}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	if len(aux.Revision) == 0 || string(aux.Revision) == "null" {
		return nil
	}
	// Try number first (cheap), then fall back to quoted-string.
	if err := json.Unmarshal(aux.Revision, &c.Revision); err == nil {
		return nil
	}
	var s string
	if err := json.Unmarshal(aux.Revision, &s); err != nil {
		return fmt.Errorf("revision: not a number or numeric string: %w", err)
	}
	if s == "" {
		return nil
	}
	v, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return fmt.Errorf("revision: %q is not a valid int64: %w", s, err)
	}
	c.Revision = v
	return nil
}

// UnmarshalJSON tolerates Config.Revision as either a JSON number
// (older iters) or a JSON string (current control-plane emit format,
// BigInt-safe). See BigInt64 for the shared helper.
func (c *Config) UnmarshalJSON(data []byte) error {
	type plain Config
	aux := struct {
		Revision BigInt64 `json:"revision"`
		*plain
	}{plain: (*plain)(c)}
	if err := json.Unmarshal(data, &aux); err != nil {
		return err
	}
	c.Revision = int64(aux.Revision)
	return nil
}

// Config is the warm-path bundle — rich, cached, refreshed by revision.
// Loaded from GET /internal/gateway/config/:vk_id with If-None-Match.
type Config struct {
	VirtualKeyID  string         `json:"vk_id"`
	Revision      int64          `json:"revision"`
	ProviderCreds []ProviderCred `json:"providers"`
	Fallback      FallbackSpec   `json:"fallback"`
	// (removed) ObservabilityEndpoint — per-project OTLP override was
	// removed in Lane B iter 25 per rchaves (we sell observability,
	// spans should always route to LangWatch). Gateway now
	// unconditionally exports to GATEWAY_OTEL_DEFAULT_ENDPOINT. The
	// JSON field name is retained implicitly via Go's ignore-unknown
	// semantics: old control planes that still emit the key get their
	// value silently dropped during Unmarshal.
	ModelAliases map[string]string `json:"model_aliases"`
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
	// CacheRules is the priority-ordered (DESC) list of cache-control
	// overrides baked into the bundle by the control plane. Evaluation
	// is first-match-wins on a linear scan by internal/cacherules —
	// no per-request DB or regex compile. Precedence: per-request
	// X-LangWatch-Cache header > matched rule > VK Cache default.
	CacheRules     []CacheRuleSpec          `json:"cache_rules"`
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

// CacheRuleSpec mirrors the cache-control-rules.feature contract §4.1:
//
//	{
//	  "id": "rule_abc", "priority": 500,
//	  "matchers": {
//	    "vk_id": "vk_xxx",              // optional exact
//	    "vk_prefix": "lw_vk_eval_",     // optional prefix
//	    "vk_tags": ["env=prod"],        // optional AND-across tags
//	    "principal_id": "user_123",     // optional exact
//	    "model": "claude-haiku-*",      // optional glob (simple *)
//	    "request_metadata": {"k": "v"}  // optional all-match
//	  },
//	  "action": {
//	    "mode": "respect|force|disable",
//	    "ttl_s": 300,   // only when mode=force
//	    "salt": "..."   // opt custom key salt
//	  }
//	}
//
// All matcher fields are optional; unspecified = wildcard. All present
// matchers must match (AND semantics). Rules are pre-sorted priority
// DESC by the control plane; the gateway just walks first-match-wins.
type CacheRuleSpec struct {
	ID       string            `json:"id"`
	Priority int               `json:"priority"`
	Matchers CacheRuleMatchers `json:"matchers"`
	Action   CacheRuleAction   `json:"action"`
}

type CacheRuleMatchers struct {
	VKID            string            `json:"vk_id,omitempty"`
	VKPrefix        string            `json:"vk_prefix,omitempty"`
	VKTags          []string          `json:"vk_tags,omitempty"`
	PrincipalID     string            `json:"principal_id,omitempty"`
	Model           string            `json:"model,omitempty"` // simple glob: trailing *
	RequestMetadata map[string]string `json:"request_metadata,omitempty"`
}

type CacheRuleAction struct {
	Mode string `json:"mode"` // respect|force|disable
	TTLS int    `json:"ttl_s,omitempty"`
	Salt string `json:"salt,omitempty"`
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
