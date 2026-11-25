package a2aproxy

import (
	"context"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// Registry finds the target a caller asked for within the caller's project.
type Registry interface {
	Lookup(ctx context.Context, bundle *domain.Bundle, name string) (domain.A2ATarget, error)
}

// BundleRegistry finds targets in the caller's config bundle, which the
// control plane fills from the project's A2A target registry.
type BundleRegistry struct{}

// Lookup implements Registry.
func (BundleRegistry) Lookup(_ context.Context, bundle *domain.Bundle, name string) (domain.A2ATarget, error) {
	if bundle != nil {
		for _, t := range bundle.Config.A2ATargets {
			if t.Name == name {
				return t, nil
			}
		}
	}
	return domain.A2ATarget{}, domain.ErrA2ATargetNotFound
}
