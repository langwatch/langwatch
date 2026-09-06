// Package modelresolver resolves raw model strings against VK config.
package modelresolver

import (
	"context"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// missingModelMessages says, per inbound surface, where that surface expects
// the model and what a correct request looks like. It is per surface because
// the surfaces genuinely disagree: three read a top-level JSON field, one
// reads a multipart form field, and the Gemini passthrough reads the URL path.
// A single message naming the JSON endpoints would tell a caller posting a
// transcription or an image edit to add a JSON field to a request that carries
// no JSON, which is worse than the vague "missing model field" it replaced.
//
// The message is the only thing that can carry this detail: resolution runs
// before the request is labeled with a model, so a rejected request records
// model="unknown" on the request counter and the operator reading their own
// client code has nothing else to go on.
var missingModelMessages = map[domain.RequestType]string{
	domain.RequestTypeChat:            jsonBodyMessage("POST /v1/chat/completions"),
	domain.RequestTypeMessages:        jsonBodyMessage("POST /v1/messages"),
	domain.RequestTypeResponses:       jsonBodyMessage("POST /v1/responses"),
	domain.RequestTypeEmbeddings:      jsonBodyMessage("POST /v1/embeddings"),
	domain.RequestTypeSpeech:          jsonBodyMessage("POST /v1/audio/speech"),
	domain.RequestTypeImageGeneration: jsonBodyMessage("POST /v1/images/generations"),
	domain.RequestTypeImageEdit: `POST /v1/images/edits sends a multipart/form-data body and takes ` +
		`the model from a form field, not from JSON. Add a "model" part naming the model or the ` +
		`virtual key's alias for it, alongside the "image" and "prompt" parts`,
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
	`part on /v1/audio/transcriptions and /v1/images/edits, or the model in the URL path on the ` +
	`Gemini surface`

// missingModelSurfaceMessages says where a route that mirrors a vendor's own
// path names the model, for the routes whose request type is shared with a
// translated route and so cannot be told apart by type alone. ElevenLabs'
// transcription path takes the same multipart shape as /v1/audio/transcriptions
// but reads a different form part, and naming the wrong one sends the caller
// to fix a field the endpoint does not read.
var missingModelSurfaceMessages = map[string]string{
	domain.ElevenLabsTranscriptionSurface().Name: `POST /v1/speech-to-text sends a multipart/form-data body ` +
		`and takes the model from a "` + domain.ElevenLabsModelField + `" form field, not from JSON. Add one ` +
		`naming the model or the virtual key's alias for it, for example "scribe_v1", alongside the audio`,
}

// missingModelMessage returns the rejection wording for the surface the
// request arrived on. A route carrying a vendor's own wire answers first,
// because its request type is shared with the translated route it mirrors.
func missingModelMessage(req *domain.Request) string {
	if req == nil {
		return fallbackMissingModelMessage
	}
	if message, ok := missingModelSurfaceMessages[req.InboundSurface().Name]; ok {
		return message
	}
	if message, ok := missingModelMessages[req.Type]; ok {
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
			"message":      missingModelMessage(req),
			"fault":        "customer",
			"request_type": string(requestType),
		})
	}

	// 1. Check aliases. The allowlist judges the model the alias resolves to,
	// not the name the caller typed: an alias is a convenience for naming a
	// model, never a way to reach one this key may not use. Returning here
	// without the check is what let an alias route around models_allowed.
	//
	// The alias target is read with the SAME vocabulary as a request, so an
	// alias pointing at a routing handle or at a model id containing a slash
	// resolves the way its author meant. Before that, any alias target whose
	// first segment was not a provider family became a request for a provider
	// nobody holds, which no key could ever serve.
	if alias, ok := config.ModelAliases[rawModel]; ok {
		// A target the wire decode already split into a family and a model is
		// a routing instruction the key's owner wrote, and it stands. A target
		// it left whole is read here, where the key's handles are known.
		resolved := domain.ResolvedModel{ModelID: alias.Model, ProviderID: alias.ProviderID}
		if alias.ProviderID == "" {
			resolved = config.ReadSpelling(alias.Model)
		}
		if !config.AllowsResolvedModel(resolved.ProviderID, resolved.ModelID) {
			return nil, herr.New(ctx, domain.ErrModelNotAllowed, herr.M{
				"message": "model not allowed: " + resolved.ModelID + ` (named "` + rawModel + `" by this key)`,
				"fault":   "customer",
			})
		}
		resolved.Source = domain.ModelSourceAlias
		return &resolved, nil
	}

	// 2. Read the spelling: a routing handle pins one instance, a known
	// provider family selects a kind, and anything else is a whole model id
	// that credential selection matches against the providers' own catalogs.
	resolved := config.ReadSpelling(rawModel)

	// Echo the spelling the caller sent when a qualifier was read. Naming the
	// bare model reads as a different refusal than the one they asked for,
	// since the same model under another provider is a separate allowance.
	refused := resolved.ModelID
	if resolved.Source == domain.ModelSourceExplicit {
		refused = rawModel
	}
	if !config.AllowsResolvedModel(resolved.ProviderID, resolved.ModelID) {
		return nil, herr.New(ctx, domain.ErrModelNotAllowed, herr.M{
			"message": "model not allowed: " + refused,
			"fault":   "customer",
		})
	}

	return &resolved, nil
}
