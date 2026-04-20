// Package http is the HTTP transport layer for the AI Gateway.
package http

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
	"github.com/langwatch/langwatch/services/aigateway/infra"
)

// RouterDeps are the dependencies for the HTTP router.
type RouterDeps struct {
	App           *app.App
	Logger        *zap.Logger
	Health        *health.Registry
	Version       string
	GatewayTracer *infra.GatewayTracer
}

// NewRouter creates the chi router with all gateway routes mounted.
func NewRouter(deps RouterDeps) http.Handler {
	registerErrorStatuses()

	r := chi.NewRouter()

	r.Use(httpmiddleware.RequestID)
	r.Use(httpmiddleware.Recover())
	r.Use(httpmiddleware.Telemetry())
	if deps.Version != "" {
		r.Use(httpmiddleware.Version("X-LangWatch-Gateway-Version", deps.Version))
	}
	if deps.GatewayTracer != nil {
		r.Use(deps.GatewayTracer.Middleware(infra.DefaultSpanName))
	}

	if deps.Health != nil {
		r.Get("/healthz", deps.Health.Liveness)
		r.Get("/readyz", deps.Health.Readiness)
		r.Get("/startupz", deps.Health.Startup)
	}

	r.Route("/v1", func(v1 chi.Router) {
		if deps.App != nil && deps.App.Auth() != nil {
			v1.Use(AuthMiddleware(deps.App.Auth()))
		}
		v1.Post("/chat/completions", dispatchHandler(deps, domain.RequestTypeChat))
		v1.Post("/messages", dispatchHandler(deps, domain.RequestTypeMessages))
		v1.Post("/embeddings", dispatchHandler(deps, domain.RequestTypeEmbeddings))
		v1.Get("/models", modelsHandler(deps))
	})

	return r
}

// dispatchHandler reads the body, builds a domain.Request, and dispatches.
func dispatchHandler(deps RouterDeps, reqType domain.RequestType) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle := BundleFromContext(r.Context())
		if bundle == nil {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{"reason": "no auth bundle on context"}))
			return
		}

		body, err := io.ReadAll(r.Body)
		if err != nil {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrBadRequest, herr.M{"reason": "failed to read request body"}))
			return
		}

		model, streaming := peekModelAndStream(body)
		req := &domain.Request{
			Type:      reqType,
			Model:     model,
			Body:      body,
			Streaming: streaming,
		}

		if streaming {
			result, dispatchErr := deps.App.DispatchStream(r.Context(), bundle, req)
			if dispatchErr != nil {
				herr.WriteHTTP(w, dispatchErr)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
			return
		}

		result, dispatchErr := deps.App.Dispatch(r.Context(), bundle, req)
		if dispatchErr != nil {
			herr.WriteHTTP(w, dispatchErr)
			return
		}

		setMetaHeaders(w, result.Meta)
		w.Header().Set("Content-Type", "application/json")
		if result.Response.StatusCode > 0 {
			w.WriteHeader(result.Response.StatusCode)
		}
		_, _ = w.Write(result.Response.Body)
	}
}

func modelsHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle := BundleFromContext(r.Context())
		if bundle == nil {
			herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInvalidAPIKey, herr.M{"reason": "no auth bundle on context"}))
			return
		}

		models, err := deps.App.ListModels(r.Context(), bundle)
		if err != nil {
			herr.WriteHTTP(w, err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data":   models,
		})
	}
}

// --- Response headers ---

func setMetaHeaders(w http.ResponseWriter, meta app.DispatchMeta) {
	if meta.GatewayRequestID != "" {
		w.Header().Set("X-LangWatch-Gateway-Request-Id", meta.GatewayRequestID)
	}
	if meta.FallbackCount > 0 {
		w.Header().Set("X-LangWatch-Fallback-Count", strconv.Itoa(meta.FallbackCount))
	}
	if len(meta.BudgetWarnings) > 0 {
		w.Header().Set("X-LangWatch-Budget-Warning", strings.Join(meta.BudgetWarnings, ","))
	}
	if meta.CacheMode != "" {
		w.Header().Set("X-LangWatch-Cache-Mode", meta.CacheMode)
	}
}

// --- SSE streaming ---

func writeSSE(ctx context.Context, w http.ResponseWriter, iter domain.StreamIterator) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, _ := w.(http.Flusher)

	for iter.Next(ctx) {
		chunk := iter.Chunk()
		_, _ = fmt.Fprintf(w, "data: %s\n\n", chunk)
		if flusher != nil {
			flusher.Flush()
		}
	}

	if err := iter.Err(); err != nil {
		// Terminal SSE error event — client knows stream ended due to error
		errJSON, _ := json.Marshal(map[string]string{"error": err.Error()})
		_, _ = fmt.Fprintf(w, "event: error\ndata: %s\n\n", errJSON)
		if flusher != nil {
			flusher.Flush()
		}
	}

	// Emit usage warning as an SSE event (headers cannot be set after WriteHeader).
	if iter.Usage().TotalTokens == 0 {
		warnJSON, _ := json.Marshal(map[string]string{"warning": "provider_did_not_report_usage_on_stream"})
		_, _ = fmt.Fprintf(w, "event: warning\ndata: %s\n\n", warnJSON)
	}

	_, _ = fmt.Fprint(w, "data: [DONE]\n\n")
	if flusher != nil {
		flusher.Flush()
	}

	_ = iter.Close()
}

// --- Error mapping ---

var errorsRegistered bool

func registerErrorStatuses() {
	if errorsRegistered {
		return
	}
	errorsRegistered = true
	herr.RegisterStatus(domain.ErrInvalidAPIKey, http.StatusUnauthorized)
	herr.RegisterStatus(domain.ErrRateLimited, http.StatusTooManyRequests)
	herr.RegisterStatus(domain.ErrBudgetExceeded, http.StatusPaymentRequired)
	herr.RegisterStatus(domain.ErrGuardrailBlocked, http.StatusForbidden)
	herr.RegisterStatus(domain.ErrBlockedPattern, http.StatusForbidden)
	herr.RegisterStatus(domain.ErrModelNotAllowed, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrProviderError, http.StatusBadGateway)
	herr.RegisterStatus(domain.ErrProviderTimeout, http.StatusGatewayTimeout)
	herr.RegisterStatus(domain.ErrBadRequest, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrChainExhausted, http.StatusBadGateway)
	herr.RegisterStatus(domain.ErrNotFound, http.StatusNotFound)
	herr.RegisterStatus(domain.ErrInternal, http.StatusInternalServerError)
}

// --- Body peeking ---

func peekModelAndStream(body []byte) (model string, streaming bool) {
	var peek struct {
		Model  string `json:"model"`
		Stream bool   `json:"stream"`
	}
	_ = json.Unmarshal(body, &peek)
	return peek.Model, peek.Stream
}
