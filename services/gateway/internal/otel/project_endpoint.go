package otel

import "sync"

// ProjectEndpointRegistry maps project_id → per-project OTLP HTTP
// endpoint (and optional headers). Populated by the auth cache as VK
// bundles are resolved / refreshed; read by RouterExporter on every
// span export.
//
// The registry is append-only in practice (endpoints don't move
// between projects); we still take a read-write lock so concurrent
// Set calls from background refresh are safe. Memory footprint is one
// entry per active project, which stays small even at large-tenant
// scale.
type ProjectEndpointRegistry struct {
	mu sync.RWMutex
	m  map[string]projectEndpointEntry
}

type projectEndpointEntry struct {
	Endpoint string
	Headers  map[string]string
}

// NewProjectEndpointRegistry returns an empty registry.
func NewProjectEndpointRegistry() *ProjectEndpointRegistry {
	return &ProjectEndpointRegistry{m: make(map[string]projectEndpointEntry)}
}

// Set records an endpoint (and optional auth headers) for the given
// project. An empty endpoint clears any existing entry, which causes
// RouterExporter to fall back to the default exporter.
func (r *ProjectEndpointRegistry) Set(projectID, endpoint string, headers map[string]string) {
	if projectID == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if endpoint == "" {
		delete(r.m, projectID)
		return
	}
	r.m[projectID] = projectEndpointEntry{Endpoint: endpoint, Headers: headers}
}

// Lookup matches the EndpointResolver signature so RouterOptions can
// plug the registry in directly.
func (r *ProjectEndpointRegistry) Lookup(projectID string) (string, map[string]string, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	e, ok := r.m[projectID]
	return e.Endpoint, e.Headers, ok
}

// Len is for tests / metrics — how many projects have a per-project
// endpoint right now.
func (r *ProjectEndpointRegistry) Len() int {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return len(r.m)
}
