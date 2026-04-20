// Package modelresolver resolves raw model strings against VK config.
// Implements app.ModelResolver.
package modelresolver

import (
	"context"
	"strings"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Resolver resolves model strings using aliases, provider prefixes, and allowlists.
type Resolver struct{}

// New creates a model resolver.
func New() *Resolver { return &Resolver{} }

// Resolve applies alias resolution → provider/model parsing → allowlist checking.
func (r *Resolver) Resolve(ctx context.Context, rawModel string, config domain.BundleConfig) (*domain.ResolvedModel, error) {
	if rawModel == "" {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": "missing model field"})
	}

	target := rawModel
	source := domain.ModelSourceImplicit

	// 1. Check aliases
	if alias, ok := config.ModelAliases[rawModel]; ok {
		target = alias.Model
		source = domain.ModelSourceAlias
		return &domain.ResolvedModel{
			ModelID:    target,
			ProviderID: alias.ProviderID,
			Source:     source,
		}, nil
	}

	// 2. Check explicit provider/model format
	if strings.Contains(target, "/") {
		source = domain.ModelSourceExplicit
		parts := strings.SplitN(target, "/", 2)
		providerID := normalizeProvider(parts[0])
		modelID := parts[1]

		if !modelAllowed(config, modelID) {
			return nil, herr.New(ctx, domain.ErrModelNotAllowed, herr.M{"model": modelID})
		}

		return &domain.ResolvedModel{
			ModelID:    modelID,
			ProviderID: providerID,
			Source:     source,
		}, nil
	}

	// 3. Implicit: infer provider from first credential
	if !modelAllowed(config, target) {
		return nil, herr.New(ctx, domain.ErrModelNotAllowed, herr.M{"model": target})
	}

	return &domain.ResolvedModel{
		ModelID:    target,
		ProviderID: "", // will be filled by credential selection
		Source:     source,
	}, nil
}

func normalizeProvider(raw string) domain.ProviderID {
	switch raw {
	case "azure_openai", "azure":
		return domain.ProviderAzure
	case "google_vertex", "vertex":
		return domain.ProviderVertex
	case "aws_bedrock", "bedrock":
		return domain.ProviderBedrock
	case "google_gemini", "gemini":
		return domain.ProviderGemini
	case "anthropic":
		return domain.ProviderAnthropic
	case "openai":
		return domain.ProviderOpenAI
	default:
		return domain.ProviderID(raw)
	}
}

func modelAllowed(config domain.BundleConfig, model string) bool {
	if len(config.AllowedModels) == 0 {
		return true
	}
	for _, pat := range config.AllowedModels {
		if matchGlob(pat, model) {
			return true
		}
	}
	return false
}

func matchGlob(pattern, s string) bool {
	if pattern == s {
		return true
	}
	if strings.HasSuffix(pattern, "*") {
		return strings.HasPrefix(s, strings.TrimSuffix(pattern, "*"))
	}
	return false
}

// Compile-time interface check.
var _ app.ModelResolver = (*Resolver)(nil)
