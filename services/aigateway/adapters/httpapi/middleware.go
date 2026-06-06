package httpapi

import (
	"context"
	"net/http"
	"strings"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/adapters/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

type bundleCtxKey struct{}

// AuthMiddleware resolves bearer tokens and attaches the bundle to context.
// If resolver is nil, all requests are rejected (fail closed).
func AuthMiddleware(resolver app.AuthResolver) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if resolver == nil {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, nil))
				return
			}

			token := extractToken(r)
			if token == "" {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{
					"message": "missing API key; supply Authorization: Bearer <key>, x-api-key, or x-goog-api-key header",
				}))
				return
			}

			bundle, err := resolver.Resolve(r.Context(), token)
			if err != nil {
				herr.WriteHTTP(w, err)
				return
			}

			ctx := context.WithValue(r.Context(), bundleCtxKey{}, bundle)

			// Enrich context logger with identity fields.
			ctx = clog.With(ctx,
				zap.String("project_id", bundle.ProjectID),
				zap.String("team_id", bundle.TeamID),
			)

			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// TraceRegistryMiddleware registers the project's OTLP endpoint after auth
// resolves the bundle. Must run after AuthMiddleware.
func TraceRegistryMiddleware(registry *customertracebridge.Registry, defaultEndpoint string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			bundle := BundleFromContext(r.Context())
			if bundle == nil {
				herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, herr.M{
					"message": "TraceRegistryMiddleware requires auth to run first",
				}))
				return
			}
			if registry != nil {
				if err := registry.SetFromBundle(
					bundle.ProjectID, bundle.Config.ProjectOTLPToken, defaultEndpoint,
				); err != nil {
					clog.Get(r.Context()).Warn("otlp_endpoint_rejected",
						zap.String("project_id", bundle.ProjectID), zap.Error(err))
				}
			}
			next.ServeHTTP(w, r)
		})
	}
}

// CustomerTraceMiddleware stashes the inbound traceparent for the bridge and
// starts a fresh gateway-owned trace context for internal spans.
func CustomerTraceMiddleware() func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := r.Context()

			// Preserve the customer's traceparent so the bridge can link to it.
			ctx = customertracebridge.WithTraceParent(ctx, r.Header.Get("Traceparent"))
			r.Header.Del("Traceparent")
			r.Header.Del("Tracestate")

			// Stash the wrapped tool's own session / conversation id. claude-code,
			// codex and opencode each send theirs as a request header on the
			// gateway (Path A) path; the emitter stamps it as gen_ai.conversation.id
			// so the trace has a real thread id instead of nothing.
			ctx = customertracebridge.WithClientSessionID(ctx, clientSessionIDFromHeaders(r.Header))

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
		if len(a) > 7 && strings.EqualFold(a[:7], "Bearer ") {
			return strings.TrimSpace(a[7:])
		}
	}
	if k := r.Header.Get("X-Api-Key"); k != "" {
		return strings.TrimSpace(k)
	}
	// X-Goog-Api-Key — Gemini SDK's canonical auth header (gemini-cli,
	// google-genai SDK). Lets a Gemini-native client point at the gateway
	// without changing its auth wiring; the VK secret slots into the same
	// place the SDK would normally put a Google API key.
	if k := r.Header.Get("X-Goog-Api-Key"); k != "" {
		return strings.TrimSpace(k)
	}
	return ""
}

// clientSessionIDFromHeaders lifts the wrapped tool's own session / conversation
// id from the request headers. Each CLI sends it under a different header:
//   - claude-code: X-Claude-Code-Session-Id
//   - opencode:    X-Session-Affinity
//   - codex:       Session-Id (mirrors body prompt_cache_key + x-codex-turn-metadata)
//
// gemini-cli sends no per-conversation id on the gateway wire (only a stable
// device id), so it returns empty there and that trace has no thread id. First
// non-empty header wins; the value is returned verbatim.
func clientSessionIDFromHeaders(h http.Header) string {
	for _, name := range []string{
		"X-Claude-Code-Session-Id",
		"X-Session-Affinity",
		"Session-Id",
	} {
		if v := strings.TrimSpace(h.Get(name)); v != "" {
			return v
		}
	}
	return ""
}
