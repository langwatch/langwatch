package domain

import (
	"context"
	"errors"
	"slices"
	"sort"
	"strings"
)

// ProviderID identifies a model provider (e.g. "openai", "anthropic", "azure").
type ProviderID string

const (
	ProviderOpenAI    ProviderID = "openai"
	ProviderAnthropic ProviderID = "anthropic"
	ProviderAzure     ProviderID = "azure"
	ProviderBedrock   ProviderID = "bedrock"
	ProviderVertex    ProviderID = "vertex"
	ProviderGemini    ProviderID = "gemini"
	// XAI, Groq, and Cerebras are Bifrost-native providers routed with a
	// plain API key (see mapProvider / credentialToBifrostKey defaults).
	ProviderXAI      ProviderID = "xai"
	ProviderGroq     ProviderID = "groq"
	ProviderCerebras ProviderID = "cerebras"
	// DeepSeek is not in Bifrost's ModelProvider enum. Its API is
	// OpenAI-compatible, so the gateway routes it through Bifrost's vLLM
	// (openai-compat) provider with DeepSeek's public endpoint as the
	// default base URL.
	ProviderDeepSeek ProviderID = "deepseek"
	// Voyage is direct-API only. Bifrost has no Voyage ModelProvider
	// enum; the gateway proxies Voyage embeddings via a thin direct
	// HTTP path. Voyage's wire format is OpenAI-compatible so no body
	// translation is needed. Voyage ships embeddings only; chat,
	// messages, and responses calls against a Voyage credential land
	// on a clean unsupported-request-type error.
	ProviderVoyage ProviderID = "voyage"
	// Custom is any OpenAI-compatible endpoint the customer hosts
	// themselves (vLLM, LiteLLM proxy, ...). Requires a base URL; the
	// API key is optional (many self-hosted servers run unauthenticated).
	ProviderCustom ProviderID = "custom"
	// ElevenLabs is a Bifrost-native provider (enum value "elevenlabs",
	// plain API key). It ships speech (TTS) and transcription (STT) only;
	// chat-family calls against an ElevenLabs credential surface the
	// provider's reject directly, same policy as Anthropic embeddings.
	ProviderElevenLabs ProviderID = "elevenlabs"
	// OpenAICodex is the user's own ChatGPT subscription, reached through
	// OpenAI's codex backend (chatgpt.com/backend-api/codex) with an OAuth
	// access token instead of an API key. Responses-API + SSE only; the
	// gateway proxies directly (no Bifrost enum) and refreshes a 401'd
	// token once via the control plane. See adapters/providers/codex.go.
	ProviderOpenAICodex ProviderID = "openai_codex"
)

// NormalizeProviderID maps the provider spellings that reach the gateway
// onto the canonical ProviderID constants above.
//
// Two vocabularies feed in and they must agree. Requests carry the prefix
// the caller typed ("vertex_ai/gemini-2.5-flash" — LiteLLM's spelling, the
// one most SDKs emit); credentials carry the provider type the control
// plane stored ("google_vertex"). Both sides used to keep their own switch,
// and the tables had drifted: the credential side accepted "vertex_ai" and
// the request side did not. A caller with a working Vertex credential then
// resolved to provider "vertex_ai", matched no credential named "vertex",
// and their traffic died against whichever credential the chain reached
// first. Normalizing through one table is what keeps that from recurring.
//
// Unknown values pass through verbatim, so a provider added to the control
// plane before this build knows its name still routes on its own ID.
func NormalizeProviderID(raw string) ProviderID {
	switch raw {
	case "azure", "azure_openai":
		return ProviderAzure
	case "bedrock", "aws_bedrock":
		return ProviderBedrock
	case "vertex", "vertex_ai", "google_vertex":
		return ProviderVertex
	case "gemini", "google_gemini":
		return ProviderGemini
	case "anthropic":
		return ProviderAnthropic
	case "openai":
		return ProviderOpenAI
	default:
		return ProviderID(raw)
	}
}

// knownProviderFamilies is the CLOSED vocabulary of first segments that mean
// "this names a provider kind" in a model string. It holds every ProviderID
// constant plus every alternative spelling NormalizeProviderID accepts and
// every provider key the control plane can store on a ModelProvider row.
//
// It exists because NormalizeProviderID passes unknown values through, which
// is right for the jobs it does (decoding a credential's stored type,
// matching an exclusion) and wrong for reading a request. A caller asking for
// the model "stealth/ox-alpha" was resolved to a provider called "stealth",
// which no key can hold, so a model a custom provider really serves was
// refused for a provider nobody named. Closing the request-side vocabulary is
// what separates a prefix from a model id that happens to contain a slash.
//
// Adding a provider means adding it here as well, otherwise its prefix stops
// being read as a prefix.
var knownProviderFamilies = map[string]struct{}{
	"openai":                {},
	"openai_codex":          {},
	"anthropic":             {},
	"azure":                 {},
	"azure_openai":          {},
	"azure_safety":          {},
	"bedrock":               {},
	"aws_bedrock":           {},
	"vertex":                {},
	"vertex_ai":             {},
	"google_vertex":         {},
	"gemini":                {},
	"google_gemini":         {},
	"google_agent_platform": {},
	"xai":                   {},
	"groq":                  {},
	"cerebras":              {},
	"deepseek":              {},
	"voyage":                {},
	"custom":                {},
	"elevenlabs":            {},
	"cloudflare":            {},
}

// KnownProviderFamily reports whether a model string's first segment names a
// provider family the gateway recognizes. Case-insensitive, because a caller
// types the prefix by hand and "OpenAI/gpt-5-mini" means what it looks like.
func KnownProviderFamily(segment string) bool {
	_, ok := knownProviderFamilies[strings.ToLower(segment)]
	return ok
}

// KnownProviderFamilies returns the recognized family spellings, sorted, for
// an error message that has to tell a caller what a prefix may be.
func KnownProviderFamilies() []string {
	out := make([]string, 0, len(knownProviderFamilies))
	for name := range knownProviderFamilies {
		out = append(out, name)
	}
	sort.Strings(out)
	return out
}

// CodexTokenRefresher exchanges a codex provider row's stored refresh token
// for a fresh access token via the control plane (which owns storage and
// rotation). A dead session (refresh rejected — the user must sign in again)
// is reported as an error wrapping ErrCodexSessionDead.
type CodexTokenRefresher interface {
	RefreshCodexToken(ctx context.Context, providerRowID string) (accessToken string, accountID string, err error)
}

// ErrCodexSessionDead is the sentinel a CodexTokenRefresher wraps when the
// stored OpenAI session cannot be refreshed. The dispatcher turns it into
// the client-facing 401 with code ErrCodexSessionExpired.
var ErrCodexSessionDead = errors.New("codex session expired; sign in again")

// Credential holds the resolved credentials for a provider.
type Credential struct {
	ID         string
	ProviderID ProviderID
	APIKey     string
	// Provider-specific fields (Azure endpoint, Bedrock region, etc.)
	Extra map[string]string
	// DeploymentMap maps public model ids → provider-specific deployment
	// names. Azure routes on deployment, not bare model id — a customer
	// subscription may have a deployment called "my-gpt5-prod" that serves
	// the "gpt-5-mini" model. Bedrock + Vertex have analogous mappings.
	// nil or empty when the provider doesn't need deployment mapping.
	DeploymentMap map[string]string

	// Handle is the operator-chosen routing handle of the ModelProvider row,
	// unique inside the organization, lowercase. A caller writes it where a
	// provider family goes ("eu/claude-sonnet-5") to reach THIS instance
	// rather than whichever instance of the family the chain reaches first.
	// Empty when the operator set none.
	Handle string

	// Models is what this credential declares it serves: the models a
	// customer declared on the provider, plus, for the hosted families, the
	// model catalog the platform ships. It is a ROUTING vocabulary, not an
	// authorization one — models_allowed is the allowlist and stays separate.
	//
	// Empty means the provider declared nothing, which is different from
	// declaring an empty catalog: a provider that has told us nothing cannot
	// be ruled out by a model it does not list, so it stays a candidate for
	// a model no other provider claims.
	Models []string
}

// ServesModel reports whether this credential declares the given model, by
// exact match. Deployment-map keys count: they are the public model ids an
// Azure or Bedrock provider answers to, and a key containing a slash
// ("team/gpt-5-prod") is exactly the case a prefix split used to eat.
//
// Exact, never prefix: a catalog match decides which vendor gets the prompt,
// and a fuzzy match there sends it to the wrong one.
func (c Credential) ServesModel(model string) bool {
	if model == "" {
		return false
	}
	if slices.Contains(c.Models, model) {
		return true
	}
	_, mapped := c.DeploymentMap[model]
	return mapped
}

// DeclaresCatalog reports whether this credential said anything about what it
// serves. A credential that declared nothing is not narrowed by a catalog
// match it cannot take part in.
func (c Credential) DeclaresCatalog() bool {
	return len(c.Models) > 0 || len(c.DeploymentMap) > 0
}

// WithDeploymentSelfMap ensures Azure / Bedrock / Vertex credentials carry a
// deployment entry for bareModel so Bifrost's per-key readers resolve a
// deployment ("deployment not found for model X" / "deployments not set"
// otherwise). By default the model id IS the deployment name
// (azure/gpt-5-mini → deployment "gpt-5-mini"), so a {bareModel: bareModel}
// self-map suffices; when the provider defines an explicit deployment (the
// model id need not equal the deployment name), the control plane / gateway
// forwards it as Extra["deployment"] and that wins. Non-mapped providers
// (OpenAI, ...) and an empty bareModel are returned unchanged.
//
// Every dispatch path shares this so Azure resolves its deployment identically
// regardless of entry point: dispatcheradapter (Studio / workflows /
// runSignature) and the gatewayproxy /go/proxy path (scenario User Simulator,
// playground). The /go/proxy path previously skipped it, so Azure calls that
// got past the endpoint check then failed deployment resolution (#5760).
func WithDeploymentSelfMap(cred Credential, bareModel string) Credential {
	if bareModel == "" {
		return cred
	}
	switch cred.ProviderID {
	case ProviderAzure, ProviderBedrock, ProviderVertex:
	default:
		return cred
	}
	if _, present := cred.DeploymentMap[bareModel]; present {
		return cred
	}
	deployment := bareModel
	if explicit := cred.Extra["deployment"]; explicit != "" {
		deployment = explicit
	}
	// Copy on write: cred arrives by value, but DeploymentMap is a reference, so
	// writing through it would land in the caller's map.
	next := make(map[string]string, len(cred.DeploymentMap)+1)
	for model, target := range cred.DeploymentMap {
		next[model] = target
	}
	next[bareModel] = deployment
	cred.DeploymentMap = next
	return cred
}

// Provider dispatches requests to a specific AI provider.
type Provider interface {
	ID() ProviderID
	Dispatch(ctx context.Context, req *Request, cred Credential) (*Response, error)
	DispatchStream(ctx context.Context, req *Request, cred Credential) (StreamIterator, error)
	ListModels(ctx context.Context, cred Credential) ([]Model, error)
}
