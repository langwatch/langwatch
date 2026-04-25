// Package httpapi is the driving HTTP adapter for nlpgo. It mounts the
// /go/* surface (the new Go engine and gateway proxy), exposes health
// endpoints, and falls through to a reverse proxy targeting the
// uvicorn child for everything else.
package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	"github.com/langwatch/langwatch/services/nlpgo/app"
	"github.com/langwatch/langwatch/services/nlpgo/domain"
)

// RouterDeps are the dependencies the router needs.
type RouterDeps struct {
	App            *app.App
	Logger         *zap.Logger
	Health         *health.Registry
	Version        string
	InternalSecret string
	// ChildProxy reverse-proxies any unmatched (non-/go/*) request to
	// the uvicorn child. Required when nlpgo is the entrypoint; nil-safe
	// for tests where there is no child.
	ChildProxy http.Handler
	// MaxRequestBodyBytes caps per-request body size. 0 = no cap (used
	// by tests). In production the operator sets this via env.
	MaxRequestBodyBytes int64
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
		g.Use(HMACAuthMiddleware(deps.InternalSecret))
		g.Get("/version", versionHandler(deps.Version))
		g.Route("/studio", func(s chi.Router) {
			s.Post("/execute_sync", executeSyncHandler(deps.App))
			s.Post("/execute", executeStreamHandler(deps.App))
		})
		g.HandleFunc("/proxy/v1/*", proxyPassthroughHandler(deps.App))
	})

	// Fall-through: proxy everything else to uvicorn child.
	if deps.ChildProxy != nil {
		r.NotFound(deps.ChildProxy.ServeHTTP)
		r.MethodNotAllowed(deps.ChildProxy.ServeHTTP)
	}

	return r
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
