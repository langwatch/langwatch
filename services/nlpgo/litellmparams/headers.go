// The x-litellm-* header -> domain.Credential mapping the /go/proxy/v1/*
// playground pass-through uses (services/nlpgo/adapters/httpapi/playground_proxy.go).
// The TS app sends each litellm_params field as an `x-litellm-<field>` header.

package litellmparams

import (
	"errors"
	"net/http"
	"strings"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Header names — case-insensitive on the wire (Go canonicalizes via
// http.Header.Get / textproto.CanonicalMIMEHeaderKey).
const (
	headerPrefix            = "x-litellm-"
	headerModel             = "x-litellm-model"
	headerCustomLLMProvider = "x-litellm-custom_llm_provider"

	// Provider-specific
	headerAPIKey       = "x-litellm-api_key"
	headerAPIBase      = "x-litellm-api_base"
	headerOrganization = "x-litellm-organization"
	headerAPIVersion   = "x-litellm-api_version"
	headerDeployment   = "x-litellm-deployment"

	headerAWSAccessKeyID     = "x-litellm-aws_access_key_id"
	headerAWSSecretAccessKey = "x-litellm-aws_secret_access_key"
	headerAWSSessionToken    = "x-litellm-aws_session_token"
	headerAWSRegion          = "x-litellm-aws_region_name"
	headerAWSRuntimeEndpoint = "x-litellm-aws_bedrock_runtime_endpoint"

	headerVertexCredentials = "x-litellm-vertex_credentials"
	headerVertexProject     = "x-litellm-vertex_project"
	headerVertexLocation    = "x-litellm-vertex_location"

	// Gemini's second door: present together, they mark an Agent Platform
	// credential and the gateway dispatches to aiplatform.googleapis.com
	// at the path they name. See
	// specs/model-providers/google-agent-platform.feature.
	headerGeminiProject  = "x-litellm-project_id"
	headerGeminiLocation = "x-litellm-region"

	headerExtraHeaders = "x-litellm-extra_headers"
	headerUseAzureGW   = "x-litellm-use_azure_gateway"
)

// ParseCredentialFromHeaders builds a domain.Credential from the
// x-litellm-* headers the TS app sends with /proxy/v1/* requests.
//
// Returns an ErrMissingProvider when neither x-litellm-model nor
// x-litellm-custom_llm_provider lets us infer the provider — without
// a provider the dispatcher can't route, and we'd rather surface a
// clear 400 to the caller than panic in the dispatcher chain.
func ParseCredentialFromHeaders(h http.Header) (domain.Credential, error) {
	model := h.Get(headerModel)
	customProvider := strings.ToLower(strings.TrimSpace(h.Get(headerCustomLLMProvider)))

	provider, ok := inferProvider(model, customProvider)
	if !ok {
		return domain.Credential{}, ErrMissingProvider
	}

	cred := domain.Credential{
		ID:         "playground-inline-" + string(provider),
		ProviderID: provider,
		Extra:      make(map[string]string),
	}

	// Only the provider shapes that ship credentials inline today are mapped;
	// others (e.g. ProviderVoyage) fall through with an empty Extra.
	switch provider {
	case domain.ProviderOpenAI, domain.ProviderAnthropic, domain.ProviderGemini,
		domain.ProviderXAI, domain.ProviderGroq, domain.ProviderCerebras,
		domain.ProviderDeepSeek:
		apiKeyFromHeaders(h, &cred)
	case domain.ProviderAzure:
		azureFromHeaders(h, &cred)
	case domain.ProviderBedrock:
		bedrockFromHeaders(h, &cred)
	case domain.ProviderVertex:
		vertexFromHeaders(h, &cred)
	default:
		// No inline credentials to map (see the comment above the switch).
	}

	// Populate the Azure / Bedrock / Vertex deployment map from the requested
	// model so Bifrost resolves a deployment on this path too. The sibling
	// dispatcheradapter path already does this; /go/proxy did not, so Azure
	// calls that cleared the endpoint check then failed deployment resolution
	// ("deployment not found for model X") (#5760).
	cred = domain.WithDeploymentSelfMap(cred, BareModel(model))

	return cred, nil
}

// apiKeyFromHeaders reads the plain api-key providers, plus OpenAI's
// organization and Gemini's Agent Platform pair.
func apiKeyFromHeaders(h http.Header, cred *domain.Credential) {
	cred.APIKey = h.Get(headerAPIKey)
	setExtra(cred.Extra, "api_base", h.Get(headerAPIBase))
	if cred.ProviderID == domain.ProviderOpenAI {
		setExtra(cred.Extra, "organization", h.Get(headerOrganization))
	}
	if cred.ProviderID == domain.ProviderGemini {
		// Both or neither — one without the other names no door, and
		// the gateway's agent-platform detection requires the pair.
		project := h.Get(headerGeminiProject)
		location := h.Get(headerGeminiLocation)
		if project != "" && location != "" {
			cred.Extra["project_id"] = project
			cred.Extra["region"] = location
		}
	}
}

// azureFromHeaders reads Azure. api_version stays unset when absent so the
// adapter falls back to Bifrost's default; x-litellm-deployment names an
// explicit deployment, which WithDeploymentSelfMap honors.
func azureFromHeaders(h http.Header, cred *domain.Credential) {
	cred.APIKey = h.Get(headerAPIKey)
	setExtra(cred.Extra, "api_base", h.Get(headerAPIBase))
	setExtra(cred.Extra, "api_version", h.Get(headerAPIVersion))
	setExtra(cred.Extra, "extra_headers", h.Get(headerExtraHeaders))
	setExtra(cred.Extra, "use_azure_gateway", h.Get(headerUseAzureGW))
	setExtra(cred.Extra, "deployment", h.Get(headerDeployment))
}

// bedrockFromHeaders reads AWS access keys, not api_key; the key pair is
// always set, even empty.
func bedrockFromHeaders(h http.Header, cred *domain.Credential) {
	cred.Extra["aws_access_key_id"] = h.Get(headerAWSAccessKeyID)
	cred.Extra["aws_secret_access_key"] = h.Get(headerAWSSecretAccessKey)
	setExtra(cred.Extra, "aws_session_token", h.Get(headerAWSSessionToken))
	setExtra(cred.Extra, "aws_region_name", h.Get(headerAWSRegion))
	setExtra(cred.Extra, "aws_bedrock_runtime_endpoint", h.Get(headerAWSRuntimeEndpoint))
}

// vertexFromHeaders reads the inline service-account JSON plus project and
// location; Vertex has no api_key.
func vertexFromHeaders(h http.Header, cred *domain.Credential) {
	setExtra(cred.Extra, "vertex_credentials", h.Get(headerVertexCredentials))
	setExtra(cred.Extra, "vertex_project", h.Get(headerVertexProject))
	setExtra(cred.Extra, "vertex_location", h.Get(headerVertexLocation))
}

// setExtra sets key only when value is non-empty.
func setExtra(extra map[string]string, key, value string) {
	if value != "" {
		extra[key] = value
	}
}

// ErrMissingProvider is returned when ParseCredentialFromHeaders can't
// figure out which provider should serve a request.
var ErrMissingProvider = errors.New("gatewayproxy: missing provider — supply x-litellm-model with provider prefix or x-litellm-custom_llm_provider")

// inferProvider derives the provider id from the explicit
// custom_llm_provider header, falling back to the model header's
// prefix (e.g. "openai/gpt-5-mini" → "openai"). Returns false when
// neither resolves.
func inferProvider(model, customProvider string) (domain.ProviderID, bool) {
	if customProvider != "" {
		if p, ok := providerForPrefix(customProvider); ok {
			return p, true
		}
	}
	if i := strings.IndexByte(model, '/'); i > 0 {
		return providerForPrefix(strings.ToLower(model[:i]))
	}
	return "", false
}

// providerForPrefix maps a TS-registry provider name (as it appears in
// model-id prefixes and the custom_llm_provider header, aliases
// included) to a routable domain provider.
func providerForPrefix(prefix string) (domain.ProviderID, bool) {
	switch prefix {
	case "openai":
		return domain.ProviderOpenAI, true
	case "anthropic":
		return domain.ProviderAnthropic, true
	case "azure", "azure_ai":
		return domain.ProviderAzure, true
	case "bedrock":
		return domain.ProviderBedrock, true
	case "vertex_ai", "vertex":
		return domain.ProviderVertex, true
	case "gemini", "google":
		return domain.ProviderGemini, true
	case "xai":
		return domain.ProviderXAI, true
	case "groq":
		return domain.ProviderGroq, true
	case "cerebras":
		return domain.ProviderCerebras, true
	case "deepseek":
		return domain.ProviderDeepSeek, true
	}
	return "", false
}

// BareModel strips the langwatch-internal provider prefix so the
// downstream provider API sees just the bare model id (OpenAI 400s on
// "openai/gpt-5-mini", expects "gpt-5-mini").
func BareModel(model string) string {
	if i := strings.IndexByte(model, '/'); i > 0 {
		return model[i+1:]
	}
	return model
}
