package authresolver

import (
	"context"

	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// ReadHeldKey re-reads a virtual key's config by id, for a holder that keeps
// a bundle outside this cache and cannot present the key again. It answers
// the bundle with the fresh config, and whether the key can still be used.
// An etag revalidates; empty reads the config outright. A key the control
// plane no longer has comes back as the fetch's own ErrInvalidAPIKey.
func (s *Service) ReadHeldKey(ctx context.Context, held *domain.Bundle, etag string) (domain.HeldKey, error) {
	res, err := s.configFetcher.FetchConfig(ctx, held.VirtualKeyID, etag)
	if err != nil {
		return domain.HeldKey{}, err
	}
	if res.NotModified {
		return domain.HeldKey{Bundle: held, ETag: res.ETag}, nil
	}
	fresh := *held
	fresh.Config = res.Config
	fresh.Credentials = res.Config.Credentials
	if res.VirtualKeyExpiryKnown {
		fresh.VirtualKeyExpiresAt = res.VirtualKeyExpiresAt
	}
	return domain.HeldKey{Bundle: &fresh, ETag: res.ETag, Revoked: res.KeyInactive}, nil
}
