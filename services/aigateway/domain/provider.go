package domain

import "context"

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
)

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
