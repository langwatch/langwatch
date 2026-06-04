// Package httpapi is the HTTP transport for the noai service.
package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/config"
	"github.com/langwatch/langwatch/pkg/health"
)

// RouterDeps are the dependencies for the HTTP router.
type RouterDeps struct {
	Logger              *zap.Logger
	Health              *health.Registry
	MaxRequestBodyBytes int64
}

// NewRouter wires the chi router with health + the OpenAI-compatible
// fake LLM endpoints.
func NewRouter(deps RouterDeps) http.Handler {
	cap := deps.MaxRequestBodyBytes
	if cap == 0 {
		cap = config.DefaultMaxRequestBodyBytes
	}

	r := chi.NewRouter()

	r.Get("/healthz", deps.Health.Liveness)
	r.Get("/readyz", deps.Health.Readiness)
	r.Get("/startupz", deps.Health.Startup)

	r.Get("/v1/models", listModelsHandler())
	r.Post("/v1/chat/completions", chatCompletionsHandler(deps.Logger, cap))
	r.Post("/v1/responses", responsesHandler(deps.Logger, cap))

	return r
}
