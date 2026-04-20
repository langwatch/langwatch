package auth

import (
	"context"
	"net/http"
	"strings"

	"github.com/langwatch/langwatch/services/gateway/internal/httpx"
	"github.com/langwatch/langwatch/services/gateway/pkg/gwerrors"
)

type ctxKey int

const bundleKey ctxKey = iota

// Middleware enforces bearer-token auth. On success, attaches the resolved
// Bundle to the request context so downstream handlers can skip re-resolve.
func Middleware(cache *Cache) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw := extractKey(r)
			if raw == "" {
				gwerrors.Write(w, httpx.IDFromContext(r.Context()),
					gwerrors.TypeInvalidAPIKey,
					"missing_api_key",
					"missing API key; supply Authorization: Bearer lw_vk_... or x-api-key",
					"")
				return
			}
			b, err := cache.Resolve(r.Context(), raw)
			if err != nil {
				switch err {
				case ErrKeyRevoked:
					gwerrors.Write(w, httpx.IDFromContext(r.Context()),
						gwerrors.TypeVirtualKeyRevoked, "virtual_key_revoked",
						"this virtual key has been revoked", "")
				case ErrInvalidKey:
					gwerrors.Write(w, httpx.IDFromContext(r.Context()),
						gwerrors.TypeInvalidAPIKey, "invalid_api_key",
						"the provided api key is not recognized", "")
				default:
					gwerrors.Write(w, httpx.IDFromContext(r.Context()),
						gwerrors.TypeServiceUnavailable, "auth_upstream_unavailable",
						"authentication service unavailable", "")
				}
				return
			}
			ctx := context.WithValue(r.Context(), bundleKey, b)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// BundleFromContext returns the Bundle attached by Middleware, or nil.
func BundleFromContext(ctx context.Context) *Bundle {
	if v, ok := ctx.Value(bundleKey).(*Bundle); ok {
		return v
	}
	return nil
}

// WithBundleForTest returns a copy of r with the given bundle
// attached under the same ctx key Middleware uses. Production code
// paths never call this; it exists so tests outside the auth package
// can inject a bundle without spinning a full cache + resolver.
func WithBundleForTest(r *http.Request, b *Bundle) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), bundleKey, b))
}

// extractKey reads the raw virtual key from either Authorization: Bearer
// or x-api-key (anthropic-compatible). First non-empty wins.
func extractKey(r *http.Request) string {
	if a := r.Header.Get("Authorization"); a != "" {
		if strings.HasPrefix(a, "Bearer ") {
			return strings.TrimSpace(strings.TrimPrefix(a, "Bearer "))
		}
	}
	if k := r.Header.Get("x-api-key"); k != "" {
		return strings.TrimSpace(k)
	}
	return ""
}
