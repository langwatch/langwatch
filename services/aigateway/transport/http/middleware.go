package http

import (
	"context"
	"net/http"
	"strings"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type bundleCtxKey struct{}

// AuthMiddleware resolves bearer tokens and attaches the bundle to context.
func AuthMiddleware(resolver app.AuthResolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := extractToken(r)
			if token == "" {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{
					"reason": "missing API key; supply Authorization: Bearer lw_vk_... or x-api-key",
				}))
				return
			}

			bundle, err := resolver.Resolve(r.Context(), token)
			if err != nil {
				herr.WriteHTTP(w, err)
				return
			}

			ctx := context.WithValue(r.Context(), bundleCtxKey{}, bundle)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// BundleFromContext returns the resolved bundle from the request context.
func BundleFromContext(ctx context.Context) *domain.Bundle {
	if v, ok := ctx.Value(bundleCtxKey{}).(*domain.Bundle); ok {
		return v
	}
	return nil
}

func extractToken(r *http.Request) string {
	if a := r.Header.Get("Authorization"); a != "" {
		if strings.HasPrefix(a, "Bearer ") {
			return strings.TrimSpace(a[7:])
		}
	}
	if k := r.Header.Get("x-api-key"); k != "" {
		return strings.TrimSpace(k)
	}
	return ""
}
