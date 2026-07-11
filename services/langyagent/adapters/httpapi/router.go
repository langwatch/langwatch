// Package httpapi is the driving adapter (HTTP transport) for the langyagent
// manager. It does auth + validation only and delegates every turn to the app.
// The router is stdlib net/http (Go 1.22+ method-and-pattern ServeMux) wrapped
// with the shared pkg/httpmiddleware chain — no third-party router, per the
// "prefer standard APIs" steer.
package httpapi

import (
	"crypto/subtle"
	"net/http"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	"github.com/langwatch/langwatch/services/langyagent/app"
	"github.com/langwatch/langwatch/services/langyagent/domain"
)

// RouterDeps are the dependencies for the HTTP router.
type RouterDeps struct {
	App    *app.App
	Logger *zap.Logger
	Health *health.Registry
	// Version stamps the X-Langy-Agent-Version response header.
	Version string
	// InternalSecret is the shared bearer secret protecting POST /chat.
	InternalSecret string
	// MaxRequestBodyBytes caps the /chat body. 0 disables the reader cap (the
	// service always configures a value — 1 MiB by default).
	MaxRequestBodyBytes int64
}

// NewRouter wires the HTTP surface: k8s health probes, the legacy /health
// alias, and the bearer-guarded POST /chat, all behind the shared middleware
// chain (RequestID → Recover → Telemetry → Version).
func NewRouter(deps RouterDeps) http.Handler {
	domain.RegisterStatuses()

	mux := http.NewServeMux()

	if deps.Health != nil {
		mux.HandleFunc("GET /healthz", deps.Health.Liveness)
		mux.HandleFunc("GET /readyz", deps.Health.Readiness)
		mux.HandleFunc("GET /startupz", deps.Health.Startup)
	}
	// Back-compat alias: the control-plane preflight (langy.ts::isAgentHealthy)
	// and the chart probes still call /health.
	mux.HandleFunc("GET /health", healthAlias(deps.App))

	mux.Handle("POST /chat", requireInternalSecret(
		deps.InternalSecret,
		chatHandler(deps.App, deps.MaxRequestBodyBytes),
	))

	// Boot the worker ahead of the turn. The control plane fires this the moment
	// it knows a turn is coming and does not wait for it; see warmHandler.
	mux.Handle("POST /warm", requireInternalSecret(
		deps.InternalSecret,
		warmHandler(deps.App, deps.MaxRequestBodyBytes),
	))

	// Middleware chain — applied so RequestID is outermost (mirrors aigateway).
	var h http.Handler = mux
	if deps.Version != "" {
		h = httpmiddleware.Version("X-Langy-Agent-Version", deps.Version)(h)
	}
	h = httpmiddleware.Telemetry()(h)
	h = httpmiddleware.Recover()(h)
	h = httpmiddleware.RequestID(h)
	return h
}

// requireInternalSecret guards a handler behind the shared internal bearer
// secret using a constant-time compare — the manager binds the cluster service
// surface, so any pod that can route to it could otherwise probe the secret one
// byte at a time via response-timing differences. On failure it writes the
// standard herr envelope (not the flat manager's ad-hoc map).
func requireInternalSecret(secret string, next http.Handler) http.Handler {
	expected := []byte("Bearer " + secret)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := []byte(r.Header.Get("Authorization"))
		if len(got) != len(expected) || subtle.ConstantTimeCompare(got, expected) != 1 {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrUnauthorized, herr.M{"message": "unauthorized"}))
			return
		}
		next.ServeHTTP(w, r)
	})
}
