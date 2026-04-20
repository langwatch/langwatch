package modelresolver

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

func TestResolve_Alias(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		ModelAliases: map[string]domain.ModelAlias{
			"my-model": {ProviderID: domain.ProviderAnthropic, Model: "claude-3-opus"},
		},
	}

	got, err := r.Resolve(context.Background(), "my-model", cfg)
	require.NoError(t, err)
	assert.Equal(t, "claude-3-opus", got.ModelID)
	assert.Equal(t, domain.ProviderAnthropic, got.ProviderID)
	assert.Equal(t, domain.ModelSourceAlias, got.Source)
}

func TestResolve_ExplicitFormat(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{}

	got, err := r.Resolve(context.Background(), "openai/gpt-4", cfg)
	require.NoError(t, err)
	assert.Equal(t, "gpt-4", got.ModelID)
	assert.Equal(t, domain.ProviderOpenAI, got.ProviderID)
	assert.Equal(t, domain.ModelSourceExplicit, got.Source)
}

func TestResolve_ExplicitFormat_NormalizedProviders(t *testing.T) {
	tests := []struct {
		name       string
		raw        string
		wantProv   domain.ProviderID
		wantModel  string
	}{
		{"azure_openai", "azure_openai/m", domain.ProviderAzure, "m"},
		{"google_vertex", "google_vertex/m", domain.ProviderVertex, "m"},
		{"aws_bedrock", "aws_bedrock/m", domain.ProviderBedrock, "m"},
		{"google_gemini", "google_gemini/m", domain.ProviderGemini, "m"},
	}

	r := New()
	cfg := domain.BundleConfig{}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := r.Resolve(context.Background(), tt.raw, cfg)
			require.NoError(t, err)
			assert.Equal(t, tt.wantProv, got.ProviderID)
			assert.Equal(t, tt.wantModel, got.ModelID)
			assert.Equal(t, domain.ModelSourceExplicit, got.Source)
		})
	}
}

func TestResolve_Implicit(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{}

	got, err := r.Resolve(context.Background(), "gpt-4", cfg)
	require.NoError(t, err)
	assert.Equal(t, "gpt-4", got.ModelID)
	assert.Equal(t, domain.ProviderID(""), got.ProviderID)
	assert.Equal(t, domain.ModelSourceImplicit, got.Source)
}

func TestResolve_Allowlist_Allowed(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		AllowedModels: []string{"gpt-4", "claude-3"},
	}

	got, err := r.Resolve(context.Background(), "gpt-4", cfg)
	require.NoError(t, err)
	assert.Equal(t, "gpt-4", got.ModelID)
}

func TestResolve_Allowlist_Blocked(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		AllowedModels: []string{"claude-3"},
	}

	_, err := r.Resolve(context.Background(), "gpt-4", cfg)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrModelNotAllowed))
}

func TestResolve_Allowlist_GlobSuffix(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		AllowedModels: []string{"gpt-*"},
	}

	tests := []struct {
		model string
	}{
		{"gpt-4"},
		{"gpt-4o"},
	}

	for _, tt := range tests {
		t.Run(tt.model, func(t *testing.T) {
			got, err := r.Resolve(context.Background(), tt.model, cfg)
			require.NoError(t, err)
			assert.Equal(t, tt.model, got.ModelID)
		})
	}
}

func TestResolve_EmptyModel(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{}

	_, err := r.Resolve(context.Background(), "", cfg)
	require.Error(t, err)
	assert.True(t, herr.IsCode(err, domain.ErrBadRequest))
}

func TestResolve_EmptyAllowlist_AllowsAll(t *testing.T) {
	r := New()
	cfg := domain.BundleConfig{
		AllowedModels: []string{},
	}

	got, err := r.Resolve(context.Background(), "anything-goes", cfg)
	require.NoError(t, err)
	assert.Equal(t, "anything-goes", got.ModelID)
}
