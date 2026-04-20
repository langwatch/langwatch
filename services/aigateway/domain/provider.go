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
)

// Credential holds the resolved credentials for a provider.
type Credential struct {
	ID         string
	ProviderID ProviderID
	APIKey     string
	// Provider-specific fields (Azure endpoint, Bedrock region, etc.)
	Extra map[string]string
}

// Provider dispatches requests to a specific AI provider.
type Provider interface {
	ID() ProviderID
	Dispatch(ctx context.Context, req *Request, cred Credential) (*Response, error)
	DispatchStream(ctx context.Context, req *Request, cred Credential) (StreamIterator, error)
	ListModels(ctx context.Context, cred Credential) ([]Model, error)
}
