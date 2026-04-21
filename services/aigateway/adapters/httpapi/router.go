// Package httpapi is the driving adapter (HTTP transport) for the AI Gateway.
package httpapi

import (
	"context"
	"encoding/json"
	"errors"
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
	"github.com/langwatch/langwatch/services/aigateway/adapters/customertracebridge"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// RouterDeps are the dependencies for the HTTP router.
type RouterDeps struct {
	App                   *app.App
	Logger                *zap.Logger
	Health                *health.Registry
	Version               string
	TraceRegistry         *customertracebridge.Registry
	DefaultExportEndpoint string
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
	r.Use(gatewaytracer.Middleware(gatewaytracer.DefaultSpanName))

	if deps.Health != nil {
		r.Get("/healthz", deps.Health.Liveness)
		r.Get("/readyz", deps.Health.Readiness)
		r.Get("/startupz", deps.Health.Startup)
	}

	r.Route("/v1", func(v1 chi.Router) {
		v1.Use(AuthMiddleware(deps.App.Auth()))
		v1.Use(TraceRegistryMiddleware(deps.TraceRegistry, deps.DefaultExportEndpoint))
		v1.Post("/chat/completions", chatHandler(deps))
		v1.Post("/messages", messagesHandler(deps))
		v1.Post("/embeddings", embeddingsHandler(deps))
		v1.Get("/models", modelsHandler(deps))
	})

	return r
}

// --- Typed dispatch handlers ---

func chatHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		body, ok := readBody(w, r)
		if !ok {
			return
		}

		if app.PeekStream(body) {
			result, err := deps.App.HandleChatStream(r.Context(), bundle, body)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
		} else {
			result, err := deps.App.HandleChat(r.Context(), bundle, body)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeJSONResponse(w, result.Response)
		}
	}
}

func messagesHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		body, ok := readBody(w, r)
		if !ok {
			return
		}

		if app.PeekStream(body) {
			result, err := deps.App.HandleMessagesStream(r.Context(), bundle, body)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
		} else {
			result, err := deps.App.HandleMessages(r.Context(), bundle, body)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeJSONResponse(w, result.Response)
		}
	}
}

func embeddingsHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		body, ok := readBody(w, r)
		if !ok {
			return
		}

		result, err := deps.App.HandleEmbeddings(r.Context(), bundle, body)
		if err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}
		setMetaHeaders(w, result.Meta)
		writeJSONResponse(w, result.Response)
	}
}

func modelsHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}

		models, err := deps.App.ListModels(r.Context(), bundle)
		if err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data":   models,
		})
	}
}

// --- Request helpers ---

func requireBundle(w http.ResponseWriter, r *http.Request, logger *zap.Logger) (*domain.Bundle, bool) {
	bundle := BundleFromContext(r.Context())
	if bundle == nil {
		logger.Error("no auth bundle on context")
		herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, nil, fmt.Errorf("auth middleware did not attach bundle to context")))
		return nil, false
	}
	return bundle, true
}

func readBody(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrBadRequest, herr.M{"message": "failed to read request body"}))
		return nil, false
	}
	return body, true
}

// --- Response writers ---

func writeJSONResponse(w http.ResponseWriter, resp *domain.Response) {
	w.Header().Set("Content-Type", "application/json")
	if resp.StatusCode > 0 {
		w.WriteHeader(resp.StatusCode)
	}
	_, _ = w.Write(resp.Body)
}

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
	if meta.CustomerTraceparent != "" {
		w.Header().Set("Traceparent", meta.CustomerTraceparent)
	}
}

// --- SSE streaming ---

// Pre-allocated SSE framing bytes — three w.Write calls instead of one
// fmt.Fprintf avoids allocating a format buffer per chunk.
var (
	sseDataPrefix  = []byte("data: ")
	sseDoubleNL    = []byte("\n\n")
	sseErrorPrefix = []byte("event: error\ndata: ")
	sseWarnPrefix  = []byte("event: warning\ndata: ")
	sseDone        = []byte("data: [DONE]\n\n")
)

func writeSSE(ctx context.Context, w http.ResponseWriter, iter domain.StreamIterator) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, _ := w.(http.Flusher)

	for iter.Next(ctx) {
		chunk := iter.Chunk()
		_, _ = w.Write(sseDataPrefix)
		_, _ = w.Write(chunk)
		_, _ = w.Write(sseDoubleNL)
		if flusher != nil {
			flusher.Flush()
		}
	}

	if err := iter.Err(); err != nil {
		errJSON, _ := json.Marshal(map[string]string{"error": err.Error()})
		_, _ = w.Write(sseErrorPrefix)
		_, _ = w.Write(errJSON)
		_, _ = w.Write(sseDoubleNL)
		if flusher != nil {
			flusher.Flush()
		}
	}

	if iter.Usage().TotalTokens == 0 {
		warnJSON, _ := json.Marshal(map[string]string{"warning": "provider_did_not_report_usage_on_stream"})
		_, _ = w.Write(sseWarnPrefix)
		_, _ = w.Write(warnJSON)
		_, _ = w.Write(sseDoubleNL)
	}

	_, _ = w.Write(sseDone)
	if flusher != nil {
		flusher.Flush()
	}

	_ = iter.Close()
}

// writeError sends a herr directly to the client. For unexpected (non-herr)
// errors it logs the details and returns a generic internal error.
func writeError(logger *zap.Logger, w http.ResponseWriter, ctx context.Context, err error) {
	var e herr.E
	if errors.As(err, &e) {
		herr.WriteHTTP(w, e)
		return
	}
	logger.Error("unhandled error", zap.Error(err))
	herr.WriteHTTP(w, herr.New(ctx, domain.ErrInternal, nil))
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
	herr.RegisterStatus(domain.ErrPolicyViolation, http.StatusForbidden)
	herr.RegisterStatus(domain.ErrModelNotAllowed, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrProviderError, http.StatusBadGateway)
	herr.RegisterStatus(domain.ErrProviderTimeout, http.StatusGatewayTimeout)
	herr.RegisterStatus(domain.ErrBadRequest, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrChainExhausted, http.StatusBadGateway)
	herr.RegisterStatus(domain.ErrNotFound, http.StatusNotFound)
	herr.RegisterStatus(domain.ErrInternal, http.StatusInternalServerError)
}
