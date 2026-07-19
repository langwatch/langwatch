package app

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func modelIDs(models []domain.Model) []string {
	ids := make([]string, 0, len(models))
	for _, m := range models {
		ids = append(ids, m.ID)
	}
	return ids
}

// @scenario "GET /v1/models returns aliases + allowed models"
// With an allowlist configured, the list is authoritative: aliases plus the
// allowlist, and no upstream discovery — models outside the allowlist would
// be blocked at dispatch anyway, so querying endpoints for them is noise.
// Spec: specs/ai-gateway/provider-routing.feature
func TestListModels_AliasesPlusAllowlist(t *testing.T) {
	providerCalled := false
	application := New(
		WithLogger(zap.NewNop()),
		WithProviders(&mockProvider{
			listFn: func(_ context.Context, _ []domain.Credential) ([]domain.Model, error) {
				providerCalled = true
				return []domain.Model{{ID: "should-not-appear"}}, nil
			},
		}),
	)

	models, err := application.ListModels(context.Background(), &domain.Bundle{
		Config: domain.BundleConfig{
			ModelAliases: map[string]domain.ModelAlias{
				"chat": {ProviderID: domain.ProviderOpenAI, Model: "gpt-5-mini"},
			},
			AllowedModels: []string{"gpt-5-mini"},
		},
	})
	require.NoError(t, err)

	assert.ElementsMatch(t, []string{"chat", "gpt-5-mini"}, modelIDs(models))
	assert.False(t, providerCalled, "allowlist is authoritative; upstream endpoints must not be queried")
}

// @scenario "GET /v1/models discovers models from self-hosted endpoints"
// Spec: specs/ai-gateway/provider-routing.feature
func TestListModels_DiscoversFromProviderWhenNoAllowlist(t *testing.T) {
	creds := []domain.Credential{{ID: "mp-1", ProviderID: domain.ProviderAnthropic}}
	application := New(
		WithLogger(zap.NewNop()),
		WithProviders(&mockProvider{
			listFn: func(_ context.Context, got []domain.Credential) ([]domain.Model, error) {
				assert.Equal(t, creds, got, "discovery must receive the bundle's credential chain")
				return []domain.Model{
					{ID: "qwen3-14b", Name: "qwen3-14b", ProviderID: domain.ProviderAnthropic},
				}, nil
			},
		}),
	)

	models, err := application.ListModels(context.Background(), &domain.Bundle{
		Credentials: creds,
		Config: domain.BundleConfig{
			ModelAliases: map[string]domain.ModelAlias{
				"qwen": {ProviderID: domain.ProviderAnthropic, Model: "qwen3-14b"},
			},
		},
	})
	require.NoError(t, err)

	assert.ElementsMatch(t, []string{"qwen", "qwen3-14b"}, modelIDs(models))
}

// @scenario "GET /v1/models filters models denied by policy rules"
// Spec: specs/ai-gateway/provider-routing.feature
func TestListModels_FiltersDeniedModels(t *testing.T) {
	application := New(WithLogger(zap.NewNop()), WithProviders(&mockProvider{}))

	models, err := application.ListModels(context.Background(), &domain.Bundle{
		Config: domain.BundleConfig{
			AllowedModels: []string{"gpt-5-mini", "gpt-4o"},
			PolicyRules: []domain.PolicyRule{
				{Pattern: "^gpt-4.*$", Type: domain.PolicyDeny, Target: domain.PolicyTargetModel},
				// Non-model rules must not affect the list.
				{Pattern: ".*", Type: domain.PolicyDeny, Target: domain.PolicyTargetTool},
			},
		},
	})
	require.NoError(t, err)

	assert.ElementsMatch(t, []string{"gpt-5-mini"}, modelIDs(models))
}

// Duplicate IDs across aliases and discovery collapse to one entry, and the
// result is sorted so pagination-less clients get a stable list.
func TestListModels_DedupesAndSorts(t *testing.T) {
	application := New(
		WithLogger(zap.NewNop()),
		WithProviders(&mockProvider{
			listFn: func(_ context.Context, _ []domain.Credential) ([]domain.Model, error) {
				return []domain.Model{{ID: "b-model"}, {ID: "a-model"}, {ID: "b-model"}}, nil
			},
		}),
	)

	models, err := application.ListModels(context.Background(), &domain.Bundle{
		Config: domain.BundleConfig{
			ModelAliases: map[string]domain.ModelAlias{
				"a-model": {ProviderID: domain.ProviderOpenAI, Model: "whatever"},
			},
		},
	})
	require.NoError(t, err)

	assert.Equal(t, []string{"a-model", "b-model"}, modelIDs(models))
}

// REPRO bug 2: allow rules targeting models are ignored by the listing —
// dispatch rejects models outside the allow pattern ("is not in
// allowlist", adapters/policy/matcher.go), so listing them promises a
// model the VK cannot actually call.
func TestListModels_FiltersModelsOutsideAllowRules(t *testing.T) {
	application := New(
		WithLogger(zap.NewNop()),
		WithProviders(&mockProvider{
			listFn: func(_ context.Context, _ []domain.Credential) ([]domain.Model, error) {
				return []domain.Model{{ID: "qwen3-14b"}, {ID: "gpt-4o"}}, nil
			},
		}),
	)

	models, err := application.ListModels(context.Background(), &domain.Bundle{
		Config: domain.BundleConfig{
			PolicyRules: []domain.PolicyRule{
				{Pattern: "^qwen.*$", Type: domain.PolicyAllow, Target: domain.PolicyTargetModel},
			},
		},
	})
	require.NoError(t, err)

	assert.ElementsMatch(t, []string{"qwen3-14b"}, modelIDs(models),
		"gpt-4o is outside the model allow pattern; dispatch would 403 it")
}
