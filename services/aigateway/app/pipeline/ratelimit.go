package pipeline

import (
	"context"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// AllowFunc checks whether a request is permitted under rate limits.
type AllowFunc func(ctx context.Context, vkID string, limits domain.RateLimits) error

// RateLimit creates an interceptor that rejects requests exceeding rate limits.
func RateLimit(allow AllowFunc) Interceptor {
	return PreOnly("ratelimit", func(ctx context.Context, call *Call) error {
		if err := allow(ctx, call.Bundle.VirtualKeyID, call.Bundle.Config.RateLimits); err != nil {
			return herr.New(ctx, domain.ErrRateLimited, nil, err)
		}
		return nil
	})
}
