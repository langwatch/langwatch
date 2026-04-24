// Package httpapi is the driving adapter (HTTP transport) for the AI Gateway.
package httpapi

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/bytedance/sonic"
	"github.com/go-chi/chi/v5"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/config"
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
	// MaxRequestBodyBytes caps the per-request body size. 0 falls back to
	// config.DefaultMaxRequestBodyBytes (32 MiB) — sized for 1M-context LLM
	// workloads where legitimate requests can be multi-MB. Set higher on
	// enterprise deployments that send full-context 1M Gemini / multi-image
	// vision payloads; lower on public edge deployments to tighten DDoS
	// protection.
	MaxRequestBodyBytes   int64
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
		v1.Use(CustomerTraceMiddleware())
		v1.Use(TraceRegistryMiddleware(deps.TraceRegistry, deps.DefaultExportEndpoint))
		v1.Post("/chat/completions", chatHandler(deps))
		v1.Post("/messages", messagesHandler(deps))
		v1.Post("/responses", responsesHandler(deps))
		v1.Post("/embeddings", embeddingsHandler(deps))
		v1.Get("/models", modelsHandler(deps))
	})

	return r
}

var (
	bodyPool = sync.Pool{
		New: func() any {
			b := new(bytes.Buffer)
			b.Grow(32 * 1024)
			return b
		},
	}
)

func chatHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}

		peek, body, release, ok := readAndPeekBody(w, r, deps.MaxRequestBodyBytes)
		if !ok {
			return
		}
		defer release()

		model := app.PeekModel(peek)
		if app.PeekStream(peek) {
			result, err := deps.App.HandleChatStream(r.Context(), bundle, body, model)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
		} else {
			result, err := deps.App.HandleChat(r.Context(), bundle, body, model)
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

		peek, body, release, ok := readAndPeekBody(w, r, deps.MaxRequestBodyBytes)
		if !ok {
			return
		}
		defer release()

		// One-off DEBUG dump of the inbound /v1/messages body — enabled by
		// LW_LOG_MESSAGE_BODY=1. Lets operators see exactly what
		// claude-code / Anthropic SDK clients send when debugging
		// shape-specific provider rejections (e.g. fields that trigger
		// HTML 5xx from Anthropic's edge). Must NOT be left on in prod —
		// dumps full request content including potentially sensitive
		// prompts.
		if os.Getenv("LW_LOG_MESSAGE_BODY") == "1" {
			deps.Logger.Info("/v1/messages request body",
				zap.Int("peek_bytes", len(peek)),
				zap.String("peek", string(peek)),
			)
		}

		model := app.PeekModel(peek)
		if app.PeekStream(peek) {
			result, err := deps.App.HandleMessagesStream(r.Context(), bundle, body, model)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
		} else {
			result, err := deps.App.HandleMessages(r.Context(), bundle, body, model)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeJSONResponse(w, result.Response)
		}
	}
}

// responsesHandler terminates POST /v1/responses — OpenAI's Responses API
// (used by codex 0.122+, which dropped wire_api="chat" support). The
// request body is Responses-API-shape (input[] / instructions / tools
// with native type, stream event frames distinct from chat.completion).
// We raw-forward to Bifrost's ResponsesRequest endpoint; Bifrost's
// OpenAI/Azure adapters handle the native wire call.
func responsesHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}

		// Large peek: codex 0.122+ and opencode send ~35-60 KiB bodies
		// (full tool schemas + multi-turn developer input arrays) where
		// the top-level `stream` field can land past the 32 KiB default
		// window. Missing it routes a streaming request through the
		// non-streaming handler, turns OpenAI's 200+SSE response into a
		// Bifrost unmarshal failure, and surfaces as a 502 with the SSE
		// frames as the error body.
		peek, body, release, ok := readAndPeekBodyLarge(w, r, deps.MaxRequestBodyBytes)
		if !ok {
			return
		}
		defer release()

		// Same one-off DEBUG body dump as /v1/messages — gated on
		// LW_LOG_MESSAGE_BODY=1. Helpful for diagnosing codex/opencode
		// /v1/responses failures where Bifrost's adapter rejects
		// codex-shaped tools[] or other Responses-API features.
		if os.Getenv("LW_LOG_MESSAGE_BODY") == "1" {
			deps.Logger.Info("/v1/responses request body",
				zap.Int("peek_bytes", len(peek)),
				zap.String("peek", string(peek)),
			)
		}

		model := app.PeekModel(peek)
		if app.PeekStream(peek) {
			result, err := deps.App.HandleResponsesStream(r.Context(), bundle, body, model)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
		} else {
			result, err := deps.App.HandleResponses(r.Context(), bundle, body, model)
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

		peek, body, release, ok := readAndPeekBody(w, r, deps.MaxRequestBodyBytes)
		if !ok {
			return
		}
		defer release()

		result, err := deps.App.HandleEmbeddings(r.Context(), bundle, body, app.PeekModel(peek))
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
		_ = sonic.ConfigDefault.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data":   models,
		})
	}
}

func requireBundle(w http.ResponseWriter, r *http.Request, logger *zap.Logger) (*domain.Bundle, bool) {
	bundle := BundleFromContext(r.Context())
	if bundle == nil {
		logger.Error("no auth bundle on context")
		herr.WriteHTTP(w, herr.New(r.Context(), domain.ErrInternal, nil, fmt.Errorf("auth middleware did not attach bundle to context")))
		return nil, false
	}
	return bundle, true
}

// Peek sizes are tuned per-endpoint: larger than needed burns memory
// on every hot-path request (256 KiB × QPS adds up on chat-completions
// where bodies are small); smaller than needed silently misroutes
// coding-agent requests on /v1/responses when `stream` lands past the
// window. /v1/chat/completions and /v1/messages keep the 32 KiB
// default; /v1/responses uses the 256 KiB variant because codex /
// opencode routinely send 30-60 KiB bodies with `stream:true` at the
// tail. Revisit per-endpoint if we observe misses elsewhere; consider
// an env knob before widening the default.
const (
	defaultPeekBytes = 32 * 1024
	largePeekBytes   = 256 * 1024
)

func readAndPeekBody(w http.ResponseWriter, r *http.Request, maxBytes int64) ([]byte, io.Reader, func(), bool) {
	return readAndPeekBodySized(w, r, maxBytes, defaultPeekBytes)
}

// readAndPeekBodyLarge peeks 256 KiB instead of the 32 KiB default.
// Use on /v1/responses where coding-agent payloads (codex, opencode)
// routinely push `stream` and other flags past the standard window —
// a miss there mis-routes a streaming request to the non-streaming
// handler, surfacing as a 502 SSE-in-error-body to the client.
func readAndPeekBodyLarge(w http.ResponseWriter, r *http.Request, maxBytes int64) ([]byte, io.Reader, func(), bool) {
	return readAndPeekBodySized(w, r, maxBytes, largePeekBytes)
}

func readAndPeekBodySized(w http.ResponseWriter, r *http.Request, maxBytes int64, peekSize int) ([]byte, io.Reader, func(), bool) {
	// Cap body size to prevent OOM on drive-by scans while leaving headroom
	// for 1M-context LLM workloads (multi-MB prompts, vision images, long
	// tool-result blocks). Zero / unset → fall back to the shared default
	// so integration tests + misconfigured deployments still get a sensible
	// ceiling.
	if maxBytes <= 0 {
		maxBytes = config.DefaultMaxRequestBodyBytes
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)

	buf := bodyPool.Get().(*bytes.Buffer)
	peeked := make([]byte, peekSize)
	n, _ := io.ReadFull(r.Body, peeked)
	peeked = peeked[:n]

	body := io.MultiReader(bytes.NewReader(peeked), r.Body)

	// Since we need to materialize for bifrost anyway, we still use the pool
	// but we only fill it if/when MaterializeBody is called in the pipeline.
	// For now, to keep it simple and satisfy the "staged approach", we pass
	// a reader that will fill the pooled buffer when read.

	var once sync.Once
	materializedBody := &lazyPooledBody{
		reader: body,
		buf:    buf,
		release: func() {
			once.Do(func() {
				buf.Reset()
				bodyPool.Put(buf)
			})
		},
	}

	return peeked, materializedBody, materializedBody.release, true
}

type lazyPooledBody struct {
	reader io.Reader
	buf    *bytes.Buffer
	release func()
}

func (l *lazyPooledBody) Read(p []byte) (n int, err error) {
	n, err = l.reader.Read(p)
	if n > 0 {
		l.buf.Write(p[:n])
	}
	return n, err
}

func writeJSONResponse(w http.ResponseWriter, resp *domain.Response) {
	w.Header().Set("Content-Type", "application/json")
	if resp.StatusCode > 0 {
		w.WriteHeader(resp.StatusCode)
	}
	_, _ = w.Write(resp.Body)
}

func setMetaHeaders(w http.ResponseWriter, meta app.DispatchMeta) {
	h := w.Header()
	if meta.GatewayRequestID != "" {
		h.Add("X-LangWatch-Gateway-Request-Id", meta.GatewayRequestID)
	}
	if meta.FallbackCount > 0 {
		h.Add("X-LangWatch-Fallback-Count", strconv.Itoa(meta.FallbackCount))
	}
	if len(meta.BudgetWarnings) > 0 {
		h.Add("X-LangWatch-Budget-Warning", strings.Join(meta.BudgetWarnings, ","))
	}
	if meta.CacheMode != "" {
		h.Add("X-LangWatch-Cache-Mode", meta.CacheMode)
	}
	if meta.CustomerTraceparent != "" {
		h.Add("Traceparent", meta.CustomerTraceparent)
	}
}

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
		errJSON, _ := sonic.Marshal(map[string]string{"error": err.Error()})
		_, _ = w.Write(sseErrorPrefix)
		_, _ = w.Write(errJSON)
		_, _ = w.Write(sseDoubleNL)
		if flusher != nil {
			flusher.Flush()
		}
	}

	if iter.Usage().TotalTokens == 0 {
		warnJSON, _ := sonic.Marshal(map[string]string{"warning": "provider_did_not_report_usage_on_stream"})
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
