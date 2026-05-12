// Package httpapi is the driving HTTP adapter for nlpgo. It mounts the
// /go/* surface (the new Go engine and gateway proxy), exposes health
// endpoints, and falls through to a reverse proxy targeting the
// uvicorn child for everything else.
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	"github.com/langwatch/langwatch/pkg/otelsetup"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// RouterDeps are the dependencies the router needs.
type RouterDeps struct {
	App     *app.App
	Logger  *zap.Logger
	Health  *health.Registry
	Version string
	// ChildProxy reverse-proxies any unmatched (non-/go/*) request to
	// the uvicorn child. Required when nlpgo is the entrypoint; nil-safe
	// for tests where there is no child.
	ChildProxy http.Handler
	// MaxRequestBodyBytes caps per-request body size. 0 = no cap (used
	// by tests). In production the operator sets this via env.
	MaxRequestBodyBytes int64
	// PlaygroundProxy serves /go/proxy/v1/* by forwarding to the
	// in-process aigateway dispatcher. nil → /go/proxy/v1/* returns the
	// 501 stub (used by tests that don't exercise the playground path).
	PlaygroundProxy PlaygroundProxy
	// OTel is the OpenTelemetry provider whose `ForceFlush` is called
	// after each /go/studio/* request, so spans for the just-finished
	// workflow ship to the collector before the Lambda runtime freezes
	// the process. nil → no per-request flush (tests, dev runs without
	// telemetry).
	OTel *otelsetup.Provider
}

// NewRouter assembles the chi router.
func NewRouter(deps RouterDeps) http.Handler {
	registerErrorStatuses()

	r := chi.NewRouter()

	r.Use(httpmiddleware.RequestID)
	r.Use(httpmiddleware.Recover())
	r.Use(httpmiddleware.Telemetry())
	if deps.Version != "" {
		r.Use(httpmiddleware.Version("X-LangWatch-NLPGO-Version", deps.Version))
	}
	if deps.MaxRequestBodyBytes > 0 {
		r.Use(httpmiddleware.MaxBodyBytes(deps.MaxRequestBodyBytes))
	}

	if deps.Health != nil {
		r.Get("/healthz", deps.Health.Liveness)
		r.Get("/readyz", deps.Health.Readiness)
		r.Get("/startupz", deps.Health.Startup)
	}

	r.Route("/go", func(g chi.Router) {
		g.Get("/version", versionHandler(deps.Version))
		g.Route("/studio", func(s chi.Router) {
			if deps.OTel != nil {
				s.Use(forceFlushMiddleware(deps.OTel))
			}
			s.Post("/execute_sync", executeSyncHandler(deps.App))
			s.Post("/execute", executeStreamHandler(deps.App))
		})
		g.HandleFunc("/proxy/v1/*", proxyPassthroughHandler(deps.PlaygroundProxy))
		g.HandleFunc("/proxy/v1beta/*", proxyPassthroughHandler(deps.PlaygroundProxy))
	})

	// Fall-through: proxy everything else to uvicorn child if a child
	// is configured. In Go-only mode (NLPGO_CHILD_BYPASS=true with no
	// upstream URL — the npx-server topology) ChildProxy is nil; we
	// short-circuit with a typed 502 + a self-explaining body so an
	// operator who forgot to force the FF on for every project sees a
	// clear message rather than chi's default 404 (which would suggest
	// the URL is wrong) or a generic dial-failure log line.
	if deps.ChildProxy != nil {
		r.NotFound(deps.ChildProxy.ServeHTTP)
		r.MethodNotAllowed(deps.ChildProxy.ServeHTTP)
	} else {
		r.NotFound(goOnlyModeFallback)
		r.MethodNotAllowed(goOnlyModeFallback)
	}

	return r
}

// goOnlyModeFallback handles non-/go/* requests when nlpgo is running
// in Go-only mode (no Python child, no upstream URL). Status code
// matches the legacy proxypass 502 ("child upstream unavailable") so
// existing client retry logic keeps working unchanged; the body
// explains what to do, since a fresh operator hitting this path is
// almost always missing the per-project feature flag override.
//
// Pinned by TestRouter_GoOnlyModeFallbackReturns502 + integration
// tests in router_go_only_mode_test.go.
func goOnlyModeFallback(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusBadGateway)
	_, _ = w.Write([]byte(
		"nlpgo is in Go-only mode (NLPGO_CHILD_BYPASS=true, no upstream " +
			"configured).\nOnly /go/* paths are served by this binary. The " +
			"main app must have release_nlp_go_engine_enabled forced on " +
			"for every project — set FEATURE_FLAG_FORCE_ENABLE=" +
			"release_nlp_go_engine_enabled in the langwatch app's env.\n" +
			"Path attempted: " + r.URL.Path + "\n",
	))
}

// forceFlushMiddleware exports any pending spans synchronously after
// each /go/studio/* request returns. Mirrors langwatch_nlp commit
// 1f1d62f55 ("flush spans immediately after workflow execution to
// avoid ~180s ingestion delay caused by Lambda freezing the
// BatchSpanProcessor background thread"). The flush runs in a fresh
// 5-second-bounded context so a hung collector can't block the
// caller indefinitely; the flush itself is best-effort — span loss
// during a collector outage is preferable to wedged requests.
func forceFlushMiddleware(provider *otelsetup.Provider) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			defer func() {
				flushCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
				defer cancel()
				_ = provider.ForceFlush(flushCtx)
			}()
			next.ServeHTTP(w, r)
		})
	}
}

var errorsRegistered bool

func registerErrorStatuses() {
	if errorsRegistered {
		return
	}
	errorsRegistered = true
	herr.RegisterStatus(domain.ErrInvalidWorkflow, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrInvalidDataset, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrUnsupportedNodeKind, http.StatusNotImplemented)
	herr.RegisterStatus(domain.ErrUnauthorized, http.StatusUnauthorized)
	herr.RegisterStatus(domain.ErrBadRequest, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrNotFound, http.StatusNotFound)
	herr.RegisterStatus(domain.ErrInternal, http.StatusInternalServerError)
	herr.RegisterStatus(domain.ErrIdleTimeout, http.StatusGatewayTimeout)
	herr.RegisterStatus(domain.ErrCodeBlockTimeout, http.StatusGatewayTimeout)
	herr.RegisterStatus(domain.ErrSSRFBlocked, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrJSONPathNoMatch, http.StatusUnprocessableEntity)
	herr.RegisterStatus(domain.ErrUpstreamHTTP, http.StatusBadGateway)
	herr.RegisterStatus(domain.ErrChildUnavailable, http.StatusServiceUnavailable)
	herr.RegisterStatus(domain.ErrGatewayUnavailable, http.StatusBadGateway)
}
