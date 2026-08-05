// Package modelresolver resolves raw model strings against VK config.
package modelresolver

import (
	"context"
	"strings"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// missingModelMessage is what a caller sees when the request body carries no
// model. It names the field AND the surfaces that require it, because the
// operator reading it is looking at their own client code rather than at ours:
// "missing model field" told them a field was missing without saying which
// field, in which body, on which endpoint, so a client stuck in a retry loop
// had nothing to correct. Resolution runs before the request is labeled with a
// model, so a rejected request records model="unknown" on the request counter
// and the message is the only thing that can carry the detail.
const missingModelMessage = `the request body has no top-level "model" field. ` +
	`Every completion endpoint (POST /v1/chat/completions, POST /v1/messages, ` +
	`POST /v1/responses) requires "model" as a top-level JSON string naming the ` +
	`model or the virtual key's alias for it, for example {"model": "claude-sonnet-4-5", ...}`

// Resolver resolves model strings using aliases, provider prefixes, and allowlists.
type Resolver struct{}

// New creates a model resolver.
func New() *Resolver { return &Resolver{} }

// Resolve applies alias resolution → provider/model parsing → allowlist checking.
func (r *Resolver) Resolve(ctx context.Context, rawModel string, config domain.BundleConfig) (*domain.ResolvedModel, error) {
	if rawModel == "" {
		// Fault is stated rather than inferred, the same way
		// errProviderNotAllowed states it: a malformed body is the caller's
		// to fix, and an unannotated rejection reads as a platform problem.
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"message": missingModelMessage,
			"fault":   "customer",
		})
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
			return nil, herr.New(ctx, domain.ErrModelNotAllowed, herr.M{"message": "model not allowed: " + modelID})
		}

		return &domain.ResolvedModel{
			ModelID:    modelID,
			ProviderID: providerID,
			Source:     source,
		}, nil
	}

	// 3. Implicit: infer provider from first credential
	if !modelAllowed(config, target) {
		return nil, herr.New(ctx, domain.ErrModelNotAllowed, herr.M{"message": "model not allowed: " + target})
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
	return config.AllowsModel(model)
}
