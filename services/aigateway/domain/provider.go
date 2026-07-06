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

// Provider dispatches requests to a specific AI provider.
type Provider interface {
	ID() ProviderID
	Dispatch(ctx context.Context, req *Request, cred Credential) (*Response, error)
	DispatchStream(ctx context.Context, req *Request, cred Credential) (StreamIterator, error)
	ListModels(ctx context.Context, cred Credential) ([]Model, error)
}
