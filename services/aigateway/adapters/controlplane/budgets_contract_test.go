package controlplane

import (
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// The provider-filtered and per-member budget contract crosses the wire in
// two places: the bundle the control plane materializes (budgets carry
// provider_key / principal_id / bucket scope_id, config carries
// providers_allowed / routing_mode) and the span attribute the gateway
// emits for the trace fold to attribute spend. These tests pin both halves
// on both sides, the same way the guardrail contract tests do: decode a
// wire-shaped fixture into domain types, then read the control-plane source
// so a rename on the TypeScript side fails here instead of silently
// un-enforcing a spending control.

// @scenario "The gateway is told each budget's provider filter and per-member bucket"
func TestBudgetWireCarriesProviderFilterAndMemberBucket(t *testing.T) {
	body := []byte(`{
		"project_id": "proj_1",
		"providers": [],
		"fallback": {"on": ["5xx"], "chain": ["mp_openai"], "timeout_ms": 30000, "max_attempts": 3},
		"model_aliases": {},
		"models_allowed": null,
		"providers_allowed": null,
		"routing_mode": "fallback_all",
		"rate_limits": {"rpm": null, "tpm": null, "rpd": null},
		"budgets": [
			{
				"id": "gb_plain", "scope": "project", "scope_id": "proj_1",
				"provider_key": null, "window": "month",
				"limit_micro_usd": 100000000, "spent_micro_usd": 5000000,
				"resets_at": 1767225600, "on_breach": "block"
			},
			{
				"id": "gb_filtered", "scope": "project", "scope_id": "proj_1|provider:mp_openai",
				"provider_key": "mp_openai", "window": "month",
				"limit_micro_usd": 50000000, "spent_micro_usd": 0,
				"resets_at": 1767225600, "on_breach": "block"
			},
			{
				"id": "gb_dept", "scope": "group", "scope_id": "grp_eng:user_a",
				"principal_id": "user_a", "provider_key": null, "window": "month",
				"limit_micro_usd": 50000000, "spent_micro_usd": 12400000,
				"resets_at": 1767225600, "on_breach": "block"
			}
		]
	}`)

	var wire configWire
	require.NoError(t, json.Unmarshal(body, &wire))
	cfg := wire.toDomain()

	require.Len(t, cfg.Budget.Scopes, 3)

	plain := cfg.Budget.Scopes[0]
	assert.Equal(t, "gb_plain", plain.ID)
	assert.Equal(t, "proj_1", plain.ScopeID)
	assert.Empty(t, plain.ProviderKey, "a null provider_key means the budget counts every dispatch")
	assert.Empty(t, plain.PrincipalID)

	filtered := cfg.Budget.Scopes[1]
	assert.Equal(t, "mp_openai", filtered.ProviderKey)
	assert.Equal(t, "proj_1|provider:mp_openai", filtered.ScopeID,
		"the bucket id arrives precomputed; the gateway never constructs it")

	dept := cfg.Budget.Scopes[2]
	assert.Equal(t, "group", dept.Scope)
	assert.Equal(t, "grp_eng:user_a", dept.ScopeID,
		"a group budget arrives as this member's own bucket")
	assert.Equal(t, "user_a", dept.PrincipalID)
}

func TestConfigWireProvidersAllowedAndRoutingMode(t *testing.T) {
	t.Run("null providers_allowed decodes to allow-all", func(t *testing.T) {
		var wire configWire
		require.NoError(t, json.Unmarshal([]byte(`{"providers_allowed": null, "routing_mode": "fallback_all"}`), &wire))
		cfg := wire.toDomain()
		assert.Empty(t, cfg.ProvidersAllowed)
		assert.True(t, cfg.AllowsProvider("mp_anything"))
	})

	t.Run("a list narrows to exactly those ModelProvider ids", func(t *testing.T) {
		var wire configWire
		require.NoError(t, json.Unmarshal([]byte(`{"providers_allowed": ["mp_a", "mp_b"]}`), &wire))
		cfg := wire.toDomain()
		assert.True(t, cfg.AllowsProvider("mp_a"))
		assert.False(t, cfg.AllowsProvider("mp_evil"))
	})

	t.Run("routing_mode none pins the attempt budget to one even if max_attempts disagrees", func(t *testing.T) {
		// The control plane already emits max_attempts 1 for no-fallback
		// keys; re-pinning at decode means a drifted bundle cannot quietly
		// re-arm fallback on a key whose owner turned it off.
		var wire configWire
		require.NoError(t, json.Unmarshal([]byte(`{
			"routing_mode": "none",
			"fallback": {"on": ["5xx"], "chain": ["mp_a", "mp_b"], "timeout_ms": 30000, "max_attempts": 3}
		}`), &wire))
		cfg := wire.toDomain()
		assert.Equal(t, domain.RoutingModeNone, cfg.RoutingMode)
		assert.Equal(t, 1, cfg.Fallback.MaxAttempts)
	})

	t.Run("fallback_all keeps the materialized attempt budget", func(t *testing.T) {
		var wire configWire
		require.NoError(t, json.Unmarshal([]byte(`{
			"routing_mode": "fallback_all",
			"fallback": {"on": ["5xx"], "chain": ["mp_a", "mp_b"], "timeout_ms": 30000, "max_attempts": 3}
		}`), &wire))
		cfg := wire.toDomain()
		assert.Equal(t, 3, cfg.Fallback.MaxAttempts)
	})
}

// The other half of the bundle contract lives in the control plane's
// materializer module. Reading it here keeps a TypeScript-side rename from
// silently stripping the provider filter (or the routing mode) off the
// wire while the UI keeps displaying both as active.
func TestControlPlaneMaterialiserEmitsTheBudgetContract(t *testing.T) {
	src := readControlPlaneSource(t, "src", "server", "gateway", "config.materialiser.ts")

	for _, needle := range []string{
		`provider_key: b.providerKey`,
		`scope_id: bucketScopeId`,
		`principal_id`,
		`providers_allowed: config.providersAllowed`,
		`routing_mode: routingModeToWire(vk.routingMode)`,
	} {
		if !strings.Contains(src, needle) {
			t.Errorf("config.materialiser.ts no longer emits %q: the bundle contract has drifted", needle)
		}
	}
	// routing_mode none must arrive with a one-attempt fallback budget so
	// gateways that predate the field still behave correctly (contract §4.2).
	// Whitespace-tolerant: a formatter may break this expression across
	// lines without breaking the contract it expresses.
	if !regexp.MustCompile(`vk\.routingMode\s*===\s*"NONE"\s*\?\s*1`).MatchString(src) {
		t.Error("config.materialiser.ts no longer pins max_attempts to 1 for routing mode NONE")
	}
}

// Bucket ids are computed control-plane-side; the gateway carries them
// verbatim. Pin the two separators so neither side can change one alone:
// "|provider:" splits a provider filter into its own bucket, ":" joins a
// group bucket as <groupId>:<userId>.
func TestControlPlaneBucketSeparatorsAreStable(t *testing.T) {
	src := readControlPlaneSource(t, "src", "server", "gateway", "budgetResolution.service.ts")

	if !strings.Contains(src, `const PROVIDER_BUCKET_SEPARATOR = "|provider:"`) {
		t.Error("budgetResolution.service.ts changed the provider bucket separator")
	}
	if !strings.Contains(src, "`${groupId}:${principalUserId}`") {
		t.Error("budgetResolution.service.ts changed the group bucket key shape")
	}
	// A dispatch with no reported provider must debit unfiltered budgets
	// only: attribution by guess mis-bills a governance control.
	if !regexp.MustCompile(`if\s*\(\s*!budget\.providerKey\s*\)\s*(\{\s*)?return\s+true`).MatchString(src) {
		t.Error("budgetAppliesToProvider no longer treats unfiltered budgets as match-all")
	}
}

// The debit attribution seam: the gateway stamps the dispatched provider on
// the customer span, and the control plane reads that same key back on two
// paths — the gateway-budget map projection derives each debit's provider from
// the span directly, and the accumulation allowlist keeps the key visible on
// the trace fold for everything else. If either side renames it,
// provider-filtered budgets stop accruing, and the failure is silent: every request
// still succeeds. This test makes the drift loud.
func TestSpanAttributeContractForProviderAttribution(t *testing.T) {
	require.Equal(t, "langwatch.model_provider_id", customertracebridge.AttrModelProviderID,
		"the Go constant is the wire name the control plane reads")

	accumulation := readControlPlaneSource(t,
		"src", "server", "event-sourcing", "pipelines", "trace-processing",
		"projections", "services", "trace-attribute-accumulation.service.ts")
	if !strings.Contains(accumulation, `"`+customertracebridge.AttrModelProviderID+`"`) {
		t.Error("the accumulation allowlist dropped langwatch.model_provider_id, so the fold will never see the provider")
	}

	projection := readControlPlaneSource(t,
		"ee", "governance", "projections", "gatewayBudgetDebits.mapProjection.ts")
	if !strings.Contains(projection, `"`+customertracebridge.AttrModelProviderID+`"`) {
		t.Error("gatewayBudgetDebits.mapProjection.ts no longer declares langwatch.model_provider_id")
	}
	// Declaring the constant is not enough — the projection has to read it off
	// the span it is deriving the debit from. Pinning the use as well as the
	// name is what keeps a rename from passing this test while provider-filtered
	// budgets quietly stop accruing.
	if !strings.Contains(projection, "spanAttributes[GATEWAY_MODEL_PROVIDER_ID_ATTR]") {
		t.Error("gatewayBudgetDebits.mapProjection.ts no longer reads langwatch.model_provider_id off the span")
	}
}

// providersAllowed semantics must agree between the two read paths: the
// control plane normalizes an empty list back to null (allow all) so a
// malformed stored row degrades instead of taking the key offline, and the
// Go side treats an empty slice the same way.
func TestProvidersAllowedEmptyListNormalization(t *testing.T) {
	src := readControlPlaneSource(t, "src", "server", "gateway", "virtualKey.config.ts")
	if !regexp.MustCompile(`v\s*&&\s*v\.length\s*>\s*0\s*\?\s*v\s*:\s*null`).MatchString(src) {
		t.Error("virtualKey.config.ts no longer normalizes an empty providersAllowed to null")
	}

	assert.True(t, domain.BundleConfig{ProvidersAllowed: []string{}}.AllowsProvider("mp_any"),
		"an empty allowlist must mean all, matching the control plane's normalization")
}
