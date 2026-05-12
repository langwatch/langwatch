// Package gatewayproxy implements the /go/proxy/v1/* OpenAI-shape
// pass-through that the LangWatch Prompt Playground uses today via the
// Python LiteLLM proxy. The Go side reads the `x-litellm-*` credential
// headers the TS app already sends, builds an in-process
// domain.Credential, and forwards the call to the gateway dispatcher.
//
// Three TS callsites talk to /proxy/v1/*:
//   - langwatch/src/server/routes/playground.ts
//   - langwatch/src/server/modelProviders/model.factory.ts
//   - langwatch/src/server/modelProviders/utils.ts
//
// All three send the customer's provider credentials as
// `x-litellm-<field>` headers. This file owns the header → Credential
// mapping that lets nlpgo speak the same shape without LiteLLM.
package gatewayproxy

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Header names — case-insensitive on the wire (Go canonicalizes via
// http.Header.Get / textproto.CanonicalMIMEHeaderKey).
const (
	headerPrefix          = "x-litellm-"
	headerModel           = "x-litellm-model"
	headerCustomLLMProvider = "x-litellm-custom_llm_provider"

	// Provider-specific
	headerAPIKey          = "x-litellm-api_key"
	headerAPIBase         = "x-litellm-api_base"
	headerOrganization    = "x-litellm-organization"
	headerAPIVersion      = "x-litellm-api_version"

	headerAWSAccessKeyID     = "x-litellm-aws_access_key_id"
	headerAWSSecretAccessKey = "x-litellm-aws_secret_access_key"
	headerAWSSessionToken    = "x-litellm-aws_session_token"
	headerAWSRegion          = "x-litellm-aws_region_name"
	headerAWSRuntimeEndpoint = "x-litellm-aws_bedrock_runtime_endpoint"

	headerVertexCredentials = "x-litellm-vertex_credentials"
	headerVertexProject     = "x-litellm-vertex_project"
	headerVertexLocation    = "x-litellm-vertex_location"

	headerExtraHeaders   = "x-litellm-extra_headers"
	headerUseAzureGW     = "x-litellm-use_azure_gateway"
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

	switch provider {
	case domain.ProviderOpenAI, domain.ProviderAnthropic, domain.ProviderGemini:
		cred.APIKey = h.Get(headerAPIKey)
		if base := h.Get(headerAPIBase); base != "" {
			cred.Extra["api_base"] = base
		}
		if provider == domain.ProviderOpenAI {
			if org := h.Get(headerOrganization); org != "" {
				cred.Extra["organization"] = org
			}
		}
	case domain.ProviderAzure:
		cred.APIKey = h.Get(headerAPIKey)
		// api_base + api_version are required for Azure routing; we
		// don't validate at this layer — let the provider adapter
		// surface a typed error if the customer has misconfigured.
		if base := h.Get(headerAPIBase); base != "" {
			cred.Extra["api_base"] = base
		}
		if ver := h.Get(headerAPIVersion); ver != "" {
			cred.Extra["api_version"] = ver
		}
		if extra := h.Get(headerExtraHeaders); extra != "" {
			cred.Extra["extra_headers"] = extra
		}
		if v := h.Get(headerUseAzureGW); v != "" {
			cred.Extra["use_azure_gateway"] = v
		}
	case domain.ProviderBedrock:
		// Bedrock uses AWS access keys, not api_key.
		cred.Extra["aws_access_key_id"] = h.Get(headerAWSAccessKeyID)
		cred.Extra["aws_secret_access_key"] = h.Get(headerAWSSecretAccessKey)
		if v := h.Get(headerAWSSessionToken); v != "" {
			cred.Extra["aws_session_token"] = v
		}
		if v := h.Get(headerAWSRegion); v != "" {
			cred.Extra["aws_region_name"] = v
		}
		if v := h.Get(headerAWSRuntimeEndpoint); v != "" {
			cred.Extra["aws_bedrock_runtime_endpoint"] = v
		}
	case domain.ProviderVertex:
		// Vertex: no api_key. Service-account JSON is inline, project
		// + location identify the GCP project.
		if v := h.Get(headerVertexCredentials); v != "" {
			cred.Extra["vertex_credentials"] = v
		}
		if v := h.Get(headerVertexProject); v != "" {
			cred.Extra["vertex_project"] = v
		}
		if v := h.Get(headerVertexLocation); v != "" {
			cred.Extra["vertex_location"] = v
		}
	}

	return cred, nil
}

// ErrMissingProvider is returned when ParseCredentialFromHeaders can't
// figure out which provider should serve a request.
var ErrMissingProvider = errors.New("gatewayproxy: missing provider — supply x-litellm-model with provider prefix or x-litellm-custom_llm_provider")

// inferProvider derives the provider id from the model header (e.g.
// "openai/gpt-5-mini" → "openai") falling back to the explicit
// custom_llm_provider header. Returns false when neither resolves.
func inferProvider(model, customProvider string) (domain.ProviderID, bool) {
	if customProvider != "" {
		switch customProvider {
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
		}
	}
	if i := strings.IndexByte(model, '/'); i > 0 {
		prefix := strings.ToLower(model[:i])
		if p, ok := providerForPrefix(prefix); ok {
			return p, true
		}
	}
	return "", false
}

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
	case "gemini":
		return domain.ProviderGemini, true
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

// LookErrorMessage formats a typed missing-provider error for HTTP
// callers. Kept as a helper so the handler can wrap consistently.
func LookErrorMessage(err error) string {
	return fmt.Sprintf("playground proxy: %s", err.Error())
}
