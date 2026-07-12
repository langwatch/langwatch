// Package rpc is the driving adapter (HTTP transport) for the langyagent
// manager — the inbound RPC surface. It does auth + validation only and
// delegates every turn to the app. The router (this file, http.go) is stdlib
// net/http (Go 1.22+ method-and-pattern ServeMux) wrapped with the shared
// pkg/httpmiddleware chain — no third-party router, per the "prefer standard
// APIs" steer. Serve() wires it in.
package rpc

import (
	"crypto/subtle"
	"net/http"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	httprpc "github.com/langwatch/langwatch/pkg/rpc"
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
	httprpc.RegisterStatuses() // bad_request / payload_too_large from the shared decoder

	mux := http.NewServeMux()

	if deps.Health != nil {
		mux.HandleFunc("GET /healthz", deps.Health.Liveness)
		mux.HandleFunc("GET /readyz", deps.Health.Readiness)
		mux.HandleFunc("GET /startupz", deps.Health.Startup)
	}
	// Back-compat alias: the control-plane preflight (langy.ts::isAgentHealthy)
	// and the chart probes still call /health.
	mux.HandleFunc("GET /health", healthAlias(deps.App))

	// Streaming turn verbs. All three run one turn on a (possibly-spawned) worker
	// through the SAME handler — the manager's Acquire reconciles create/reuse/revive
	// internally — and differ only in the intent label they record (create/revive/
	// continue), so per-intent latency and volume are visible in logs + metrics. The
	// turn streams an arbitrarily long ndjson response, so it does not fit the typed
	// request/response RPC and stays a bespoke handler.
	for _, intent := range []string{workerIntentCreate, workerIntentRevive, workerIntentContinue} {
		mux.Handle("POST /worker/"+intent, requireInternalSecret(
			deps.InternalSecret,
			chatHandler(deps.App, deps.MaxRequestBodyBytes, intent),
		))
	}

	// Typed RPC verbs (RPC.Handle*): the generic adapters decode+validate the body
	// and serialize the result. Warm boots the worker ahead of the turn (fire-and-
	// forget, 204); probe answers "do you already have a matching worker?" so the
	// control plane can skip minting a session key a reused worker would discard.
	rpc := NewRPC(deps.App, deps.MaxRequestBodyBytes)
	mux.Handle("POST /warm", requireInternalSecret(
		deps.InternalSecret,
		httprpc.HandleNoContent(rpc.maxBodyBytes, rpc.HandleWarm),
	))
	mux.Handle("POST /worker/probe", requireInternalSecret(
		deps.InternalSecret,
		httprpc.Handle(rpc.maxBodyBytes, rpc.HandleProbe),
	))

	// Middleware chain — applied so RequestID is outermost (mirrors aigateway).
	var h http.Handler = mux
	if deps.Version != "" {
		h = httpmiddleware.Version("X-Langy-Agent-Version", deps.Version)(h)
	}
	h = httpmiddleware.Telemetry()(h)
	// OUTSIDE Telemetry, so the request logger's context already carries the span
	// and logs correlate to the trace by id. This is what adopts the control
	// plane's `traceparent` (injected in langy.ts) as our parent — without it the
	// manager's spans start a fresh, orphaned trace and the turn's two halves
	// cannot be stitched into one waterfall.
	h = httpmiddleware.Tracing("langwatch.langyagent.httpapi")(h)
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
