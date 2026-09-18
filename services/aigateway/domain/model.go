package domain

// Model represents an available model from a provider.
type Model struct {
	ID         string
	Name       string
	ProviderID ProviderID
}

// ModelDiscoveryGapReason says why a provider in the credential chain
// contributed no catalog to GET /v1/models.
type ModelDiscoveryGapReason string

const (
	// ModelDiscoveryNotEnumerable: the gateway has no way to list this
	// provider's models (no catalog endpoint for the credential shape, and
	// no deployment map to read model names from).
	ModelDiscoveryNotEnumerable ModelDiscoveryGapReason = "not-enumerable"
	// ModelDiscoveryProbeFailed: the provider has a catalog endpoint but
	// this round's probe did not deliver (endpoint down or slow, key
	// rejected, endpoint policy refused the URL).
	ModelDiscoveryProbeFailed ModelDiscoveryGapReason = "probe-failed"
)

// ModelDiscoveryGap records a provider that dispatch can route to but whose
// models the catalog could not include, and why. Surfacing gaps keeps
// discovery and dispatch coherent: a virtual key that can complete against
// a provider must never silently list nothing for it. Where the catalog
// legitimately cannot be enumerated, the response says so instead of
// reading as "no models".
type ModelDiscoveryGap struct {
	ProviderID ProviderID
	Reason     ModelDiscoveryGapReason
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
