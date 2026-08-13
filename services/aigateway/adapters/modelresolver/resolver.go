// Package modelresolver resolves raw model strings against VK config.
package modelresolver

import (
	"context"
	"strings"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// missingModelMessages says, per inbound surface, where that surface expects
// the model and what a correct request looks like. It is per surface because
// the surfaces genuinely disagree: three read a top-level JSON field, one
// reads a multipart form field, and the Gemini passthrough reads the URL path.
// A single message naming the JSON endpoints would tell a caller posting a
// transcription to add a JSON field to a request that carries no JSON, which
// is worse than the vague "missing model field" it replaced.
//
// The message is the only thing that can carry this detail: resolution runs
// before the request is labeled with a model, so a rejected request records
// model="unknown" on the request counter and the operator reading their own
// client code has nothing else to go on.
var missingModelMessages = map[domain.RequestType]string{
	domain.RequestTypeChat:       jsonBodyMessage("POST /v1/chat/completions"),
	domain.RequestTypeMessages:   jsonBodyMessage("POST /v1/messages"),
	domain.RequestTypeResponses:  jsonBodyMessage("POST /v1/responses"),
	domain.RequestTypeEmbeddings: jsonBodyMessage("POST /v1/embeddings"),
	domain.RequestTypeSpeech:     jsonBodyMessage("POST /v1/audio/speech"),
	domain.RequestTypeTranscription: `POST /v1/audio/transcriptions sends a multipart/form-data body ` +
		`and takes the model from a form field, not from JSON. Add a "model" part naming the ` +
		`model or the virtual key's alias for it, alongside the "file" part`,
	// Deliberately names the URL-path convention rather than one specific
	// action: cachedContents and tuning operations also encode the model in
	// the path, under a different action than generateContent.
	domain.RequestTypePassthrough: `the Gemini surface takes the model from the URL path, not from the ` +
		`request body. Name the model in the request path the way this endpoint expects, for example ` +
		`/v1beta/models/gemini-2.5-flash:generateContent`,
}

// jsonBodyMessage is the wording shared by the surfaces that read a top-level
// JSON "model" field.
func jsonBodyMessage(endpoint string) string {
	return endpoint + ` requires a top-level "model" field in the JSON request body. ` +
		`Set it to a string naming the model or the virtual key's alias for it, ` +
		`for example {"model": "claude-sonnet-4-5", ...}`
}

// fallbackMissingModelMessage answers a request type with no entry above. It
// stays surface-agnostic rather than guessing an endpoint, because naming the
// wrong one is what this map exists to avoid.
const fallbackMissingModelMessage = `this request names no model. Supply one the way this endpoint ` +
	`expects: a top-level "model" field in the JSON body on the completion endpoints, a "model" form ` +
	`part on /v1/audio/transcriptions, or the model in the URL path on the Gemini surface`

// missingModelMessage returns the rejection wording for the surface the
// request arrived on.
func missingModelMessage(requestType domain.RequestType) string {
	if message, ok := missingModelMessages[requestType]; ok {
		return message
	}
	return fallbackMissingModelMessage
}

// Resolver resolves model strings using aliases, provider prefixes, and allowlists.
type Resolver struct{}

// New creates a model resolver.
func New() *Resolver { return &Resolver{} }

// Resolve applies alias resolution → provider/model parsing → allowlist
// checking. It takes the whole request rather than the raw model string alone
// because a rejection has to name the surface the caller actually used, and
// only the request knows which one that was.
func (r *Resolver) Resolve(ctx context.Context, req *domain.Request, config domain.BundleConfig) (*domain.ResolvedModel, error) {
	rawModel := ""
	requestType := domain.RequestType("")
	if req != nil {
		rawModel, requestType = req.Model, req.Type
	}
	if rawModel == "" {
		// Fault is stated rather than inferred, the same way
		// errProviderNotAllowed states it: a malformed body is the caller's
		// to fix, and an unannotated rejection reads as a platform problem.
		return nil, herr.New(ctx, domain.ErrMissingModel, herr.M{
			"message":      missingModelMessage(requestType),
			"fault":        "customer",
			"request_type": string(requestType),
		})
	}

	target := rawModel
	source := domain.ModelSourceImplicit

	// 1. Check aliases. The allowlist judges the model the alias resolves to,
	// not the name the caller typed: an alias is a convenience for naming a
	// model, never a way to reach one this key may not use. Returning here
	// without the check is what let an alias route around models_allowed.
	if alias, ok := config.ModelAliases[rawModel]; ok {
		if !config.AllowsResolvedModel(alias.ProviderID, alias.Model) {
			return nil, herr.New(ctx, domain.ErrModelNotAllowed, herr.M{
				"message": "model not allowed: " + alias.Model + ` (named "` + rawModel + `" by this key)`,
				"fault":   "customer",
			})
		}
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

		if !config.AllowsResolvedModel(providerID, modelID) {
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
