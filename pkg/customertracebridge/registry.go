package customertracebridge

import (
	"errors"
	"net/url"

	lru "github.com/hashicorp/golang-lru/v2"
)

const defaultRegistrySize = 10_000

// Registry maps project ID → OTLP endpoint + auth headers, bounded by an LRU.
type Registry struct {
	cache *lru.Cache[string, registryEntry]
}

type registryEntry struct {
	endpoint string
	headers  map[string]string
}

// NewRegistry creates a bounded registry. Size defaults to 10,000 entries.
func NewRegistry() *Registry {
	return NewRegistryWithSize(defaultRegistrySize)
}

// NewRegistryWithSize creates a registry with a custom capacity.
func NewRegistryWithSize(size int) *Registry {
	c, _ := lru.New[string, registryEntry](size)
	return &Registry{cache: c}
}

// ErrInvalidEndpoint is returned when an OTLP endpoint has a disallowed scheme.
var ErrInvalidEndpoint = errors.New("otlp endpoint must use http or https scheme")

// Set records an endpoint for a project. Empty endpoint clears the entry.
// Returns an error if the endpoint scheme is not http/https.
func (r *Registry) Set(projectID, endpoint string, headers map[string]string) error {
	if projectID == "" {
		return nil
	}
	if endpoint == "" {
		r.cache.Remove(projectID)
		return nil
	}
	if err := validateEndpointScheme(endpoint); err != nil {
		return err
	}
	r.cache.Add(projectID, registryEntry{endpoint: endpoint, headers: headers})
	return nil
}

// SetFromBundle registers the project's OTLP endpoint from a resolved bundle.
// A bundle that carries the project but no token (or no endpoint) is a
// REVOCATION: the cached entry is removed so the bridge stops exporting with a
// credential the control plane no longer vouches for. Leaving the entry in
// place would keep shipping spans under the stale token until LRU eviction.
func (r *Registry) SetFromBundle(projectID, otlpToken, defaultEndpoint string) error {
	if projectID == "" {
		return nil
	}
	if otlpToken == "" || defaultEndpoint == "" {
		r.cache.Remove(projectID)
		return nil
	}
	return r.Set(projectID, defaultEndpoint, map[string]string{"X-Auth-Token": otlpToken})
}

// Lookup returns the endpoint for a project.
func (r *Registry) Lookup(projectID string) (string, map[string]string, bool) {
	e, ok := r.cache.Get(projectID)
	if !ok {
		return "", nil, false
	}
	return e.endpoint, e.headers, true
}

func validateEndpointScheme(endpoint string) error {
	u, err := url.Parse(endpoint)
	if err != nil {
		return ErrInvalidEndpoint
	}
	switch u.Scheme {
	case "http", "https":
		return nil
	default:
		return ErrInvalidEndpoint
	}
}
