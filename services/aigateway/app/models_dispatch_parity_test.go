package app

import (
	"bytes"
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/adapters/modelresolver"
	"github.com/langwatch/langwatch/services/aigateway/adapters/policy"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// GET /v1/models and POST have to agree about which names a key can use.
// They are separate code paths reading the same config, so each rule the
// dispatcher applies has a twin in the listing, and a twin is exactly the
// kind of thing that drifts.
//
// The test walks both directions on one bundle: every name the list offers
// must dispatch, and every name that dispatches must be offered.
func TestListModels_AgreesWithDispatch(t *testing.T) {
	bundle := testBundle(
		domain.Credential{ID: "cred-openai", ProviderID: domain.ProviderOpenAI, APIKey: "sk-test"},
		domain.Credential{ID: "cred-anthropic", ProviderID: domain.ProviderAnthropic, APIKey: "sk-test"},
	)
	bundle.Config.AllowedModels = []string{"openai/gpt-5-mini", "claude-*", "vertex/gemini-2.5-pro"}
	bundle.Config.ModelAliases = map[string]domain.ModelAlias{
		// Allowed through the provider-qualified spelling.
		"fast": {ProviderID: domain.ProviderOpenAI, Model: "gpt-5-mini"},
		// Allowed through the bare wildcard.
		"complex": {ProviderID: domain.ProviderAnthropic, Model: "claude-opus-4-5"},
		// Outside the allowlist entirely.
		"forbidden": {ProviderID: domain.ProviderOpenAI, Model: "gpt-4o"},
		// Inside the allowlist, but the policy denies what it resolves to.
		"denied": {ProviderID: domain.ProviderAnthropic, Model: "claude-haiku-4-5"},
		// Allowed and undenied, but pointed at a provider this key holds no
		// credential for, the state an allowlist lands in when an admin
		// removes a provider.
		"unreachable": {ProviderID: domain.ProviderVertex, Model: "claude-opus-4-5"},
	}
	bundle.Config.PolicyRules = []domain.PolicyRule{
		{Pattern: "^anthropic/claude-haiku.*", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
	}

	application := New(
		WithProviders(&mockProvider{
			dispatchFn: func(_ context.Context, _ *domain.Request, _ domain.Credential) (*domain.Response, error) {
				return successResponse(), nil
			},
			listFn: func(_ context.Context, _ []domain.Credential) ([]domain.Model, []domain.ModelDiscoveryGap, error) {
				return nil, nil, nil
			},
		}),
		WithPolicy(policy.NewMatcher()),
		WithModels(modelresolver.New()),
		WithLogger(zap.NewNop()),
	)

	listed, _, err := application.ListModels(context.Background(), bundle)
	require.NoError(t, err)
	offered := map[string]bool{}
	for _, m := range listed {
		offered[m.ID] = true
	}

	dispatches := func(name string) bool {
		body := []byte(`{"model":"` + name + `","messages":[]}`)
		_, err := application.HandleChat(context.Background(), bundle, bytes.NewReader(body), name)
		return err == nil
	}

	names := []string{"vertex/gemini-2.5-pro", "openai/gpt-5-mini"}
	for name := range bundle.Config.ModelAliases {
		names = append(names, name)
	}
	for _, name := range names {
		served := dispatches(name)
		assert.Equal(t, served, offered[name],
			"%q: listed=%v but dispatchable=%v; the list and POST disagree",
			name, offered[name], served)
	}

	// Pin the expected verdicts too, so a change that makes both sides
	// agree on the wrong answer still fails.
	assert.True(t, offered["fast"], "a provider-qualified allowance must be offered")
	assert.True(t, offered["complex"], "a bare wildcard allowance must be offered")
	assert.False(t, offered["forbidden"], "an alias outside models_allowed must not be offered")
	assert.False(t, offered["denied"], "an alias the policy denies must not be offered")
	assert.False(t, offered["unreachable"],
		"an alias on a provider the key cannot reach must not be offered")
	assert.False(t, offered["vertex/gemini-2.5-pro"],
		"an allowed model on a provider the key cannot reach must not be offered")
}

// The same rule for models the provider catalog reports rather than ones an
// alias names. Discovery runs when the allowlist carries a wildcard, and it
// reports bare ids, so a provider-qualified pattern has to be matched against
// the qualified spelling or it hides every model it means to allow.
func TestListModels_DiscoveredModelMatchesQualifiedAllowance(t *testing.T) {
	bundle := testBundle()
	bundle.Config.AllowedModels = []string{"openai/gpt-5-*"}

	application := New(
		WithProviders(&mockProvider{
			listFn: func(_ context.Context, _ []domain.Credential) ([]domain.Model, []domain.ModelDiscoveryGap, error) {
				return []domain.Model{
					{ID: "gpt-5-mini", ProviderID: domain.ProviderOpenAI},
					{ID: "gpt-4o", ProviderID: domain.ProviderOpenAI},
					{ID: "gpt-5-nano", ProviderID: domain.ProviderAnthropic},
				}, nil, nil
			},
		}),
		WithModels(modelresolver.New()),
		WithLogger(zap.NewNop()),
	)

	listed, _, err := application.ListModels(context.Background(), bundle)
	require.NoError(t, err)
	assert.Contains(t, modelIDs(listed), "gpt-5-mini")
	assert.NotContains(t, modelIDs(listed), "gpt-4o")
	// The pattern names a provider, so a same-named model on another
	// provider is not what it allowed.
	assert.NotContains(t, modelIDs(listed), "gpt-5-nano")
}
