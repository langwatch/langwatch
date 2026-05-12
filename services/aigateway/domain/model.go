package domain

// Model represents an available model from a provider.
type Model struct {
	ID         string
	Name       string
	ProviderID ProviderID
}

// ResolvedModel is the result of model resolution from a request.
type ResolvedModel struct {
	ModelID    string      // the canonical model ID sent to the provider
	ProviderID ProviderID  // which provider serves this model
	Source     ModelSource // how the model was resolved
}

// ModelSource tracks how a model was resolved (for observability).
type ModelSource string

const (
	ModelSourceAlias    ModelSource = "alias"    // resolved via model_aliases config
	ModelSourceExplicit ModelSource = "explicit" // provider/model explicit format
	ModelSourceImplicit ModelSource = "implicit" // direct model name, provider inferred
)
