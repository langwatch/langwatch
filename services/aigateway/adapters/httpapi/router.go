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
	"time"

	"github.com/bytedance/sonic"
	"github.com/go-chi/chi/v5"
	"github.com/tidwall/gjson"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/clog"
	"github.com/langwatch/langwatch/pkg/config"
	"github.com/langwatch/langwatch/pkg/customertracebridge"
	"github.com/langwatch/langwatch/pkg/health"
	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/pkg/httpmiddleware"
	"github.com/langwatch/langwatch/services/aigateway/adapters/controlplane"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaymetrics"
	"github.com/langwatch/langwatch/services/aigateway/adapters/gatewaytracer"
	"github.com/langwatch/langwatch/services/aigateway/adapters/ottlserver"
	"github.com/langwatch/langwatch/services/aigateway/app"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// RouterDeps are the dependencies for the HTTP router.
type RouterDeps struct {
	App    *app.App
	Logger *zap.Logger
	Health *health.Registry
	// Metrics serves /metrics and backs the request middleware. Optional;
	// when nil no metrics are recorded and /metrics is not mounted.
	Metrics               *gatewaymetrics.Recorder
	Version               string
	TraceRegistry         *customertracebridge.Registry
	DefaultExportEndpoint string
	// OTTLServer handles /internal/validate-ottl and /internal/transform.
	// Optional; when nil, the /internal/* routes are not mounted. The
	// service runs without it for backwards-compat with old configs that
	// don't expect ingestion-source OTTL traffic.
	OTTLServer *ottlserver.Server
	// InternalSecret is the HMAC shared secret protecting /internal/*.
	// Required when OTTLServer is set.
	InternalSecret string
	// MaxRequestBodyBytes caps the per-request body size. 0 falls back to
	// config.DefaultMaxRequestBodyBytes (32 MiB), which fits a 1M-context
	// multimodal payload. Raise it on a deployment that legitimately sends
	// more, lower it on a public edge deployment to tighten DDoS
	// protection.
	MaxRequestBodyBytes int64
	// HeartbeatInterval sets how often a non-streaming response writes a
	// keep-alive byte while dispatch is still in flight, so a large-context
	// completion that legitimately runs long doesn't sit silent long enough
	// for an edge proxy (e.g. Cloudflare's ~100s default) to kill the
	// connection with a 524 — see
	// specs/ai-gateway/non-streaming-time-to-first-byte.feature and
	// https://github.com/langwatch/langwatch/issues/4806. 0 falls back to
	// config.DefaultNonStreamingHeartbeatInterval (45s); negative disables
	// heartbeating entirely.
	HeartbeatInterval time.Duration
	// Status backs the public GET /health status-page endpoint
	// (specs/ai-gateway/gateway-health.feature). Optional in the type so a
	// router can be built without it, but a nil reporter makes /health
	// answer 503: a gateway that cannot observe its control plane must not
	// report itself healthy to a public status page.
	Status StatusReporter
	// ControlPlaneBaseURL is the resolved control-plane target this
	// gateway process ships spend, budget and auth traffic to. Surfaced
	// read-only on GET /debug/control-plane so dev tooling can tell a
	// stale or foreign gateway apart from this worktree's own before
	// reusing an already-bound port (specs/setup/
	// aigateway-control-plane-target.feature).
	ControlPlaneBaseURL string
	// WebhookRelay forwards a vendor post-call delivery to the control
	// plane, which owns the per-tenant secret that verifies it. Optional;
	// when nil the webhook route is not mounted and a customer bills voice
	// through the reconciler alone.
	WebhookRelay WebhookRelay
}

// WebhookRelay hands one vendor delivery to the control plane byte for byte.
// The gateway never verifies or parses a delivery: the secret is per tenant
// and lives in the control plane's database.
type WebhookRelay interface {
	ForwardElevenLabsWebhook(
		ctx context.Context, relay controlplane.WebhookRelay,
	) (controlplane.WebhookRelayResult, error)
}

// NewRouter creates the chi router with all gateway routes mounted.
func NewRouter(deps RouterDeps) http.Handler {
	registerErrorStatuses()

	r := chi.NewRouter()

	r.Use(httpmiddleware.RequestID)
	// Metrics sit outside Recover so a panic is counted as the 500 the
	// recovery middleware turns it into, not as whatever status had been
	// written before the stack unwound. Probes and the scrape endpoint
	// exclude themselves from the counters.
	r.Use(gatewaymetrics.Middleware(deps.Metrics))
	r.Use(httpmiddleware.Recover())
	// OUTSIDE Telemetry, and that ordering is load-bearing. Telemetry captures
	// its context up front (`ctx := clog.With(r.Context(), ...)`) and logs
	// `request_completed` with that same value AFTER the inner chain returns,
	// so anything a later middleware adds to a DERIVED context is invisible to
	// it. Registered after Telemetry, the tracer's trace_id/span_id landed on a
	// context the access log never reads: 0 of 10,762 gateway records carried a
	// trace_id, against 98.7% for langyagent, which wires the same two
	// middlewares the other way round and says so in a comment.
	r.Use(gatewaytracer.Middleware(gatewaytracer.DefaultSpanName))
	r.Use(httpmiddleware.Telemetry())
	if deps.Version != "" {
		r.Use(httpmiddleware.Version("X-LangWatch-Gateway-Version", deps.Version))
	}

	if deps.Health != nil {
		r.Get("/healthz", deps.Health.Liveness)
		r.Get("/readyz", deps.Health.Readiness)
		r.Get("/startupz", deps.Health.Startup)
	}

	// Public status-page surface, distinct from the k8s probes above: the
	// probes gate pod lifecycle in-cluster, while /health is exposed
	// through the ingress for status.langwatch.ai. HEAD is registered
	// explicitly because chi does not fall HEAD back to GET, and uptime
	// monitors commonly probe with HEAD.
	statusRoute := statusHandler(deps.Status)
	r.Get("/health", statusRoute)
	r.Head("/health", statusRoute)

	// Unauthenticated like the probes: the cluster's scraper has no
	// virtual key, and the endpoint is kept off the public ingress by the
	// chart rather than by a credential.
	if deps.Metrics != nil {
		r.Handle("/metrics", deps.Metrics.Handler())
	}

	// Unauthenticated and kept off the public ingress the same way as the
	// probes and /metrics above (charts/gateway/templates/ingress.yaml
	// allowlists only /v1 and the exact /health path). Reveals nothing but
	// a URL: dev tooling polls it to verify an already-running gateway
	// before trusting it on a reused port.
	r.Get("/debug/control-plane", debugControlPlaneHandler(deps.ControlPlaneBaseURL))

	r.Route("/v1", func(v1 chi.Router) {
		// The ElevenLabs post-call webhook, and the one route under /v1 that
		// carries no virtual key. The caller is ElevenLabs, which has no key
		// and never will; the delivery authenticates itself with the HMAC the
		// control plane checks against the tenant's stored secret.
		//
		// Under /v1 rather than a path of its own so that a self-hosted
		// install that already publishes the gateway gets voice billing with
		// no ingress change: the chart allowlists /v1 as a prefix. It is on
		// the gateway rather than the control plane because a webhook has to
		// be reachable from the vendor's network, the gateway is public by
		// design, and the control plane is the admin surface that self-hosted
		// customers keep behind a VPN.
		if deps.WebhookRelay != nil {
			v1.Post("/convai/webhook/{model_provider_id}", elevenLabsWebhookHandler(deps))
		}

		v1.Group(func(v1 chi.Router) {
			v1.Use(AuthMiddleware(deps.App.Auth()))
			v1.Use(DispatchMetaMiddleware())
			v1.Use(CustomerTraceMiddleware())
			v1.Use(TraceRegistryMiddleware(deps.TraceRegistry, deps.DefaultExportEndpoint))
			v1.Post("/chat/completions", chatHandler(deps))
			v1.Post("/messages", messagesHandler(deps))
			v1.Post("/responses", responsesHandler(deps))
			v1.Post("/embeddings", embeddingsHandler(deps))
			v1.Post("/audio/speech", speechHandler(deps))
			v1.Post("/audio/transcriptions", transcriptionsHandler(deps))
			v1.Get("/models", modelsHandler(deps))
			// Realtime voice session mints (ADR-097). Both paths mirror the
			// vendor's own, so a vendor SDK pointed at the gateway base URL
			// mints through us with no code change. The media socket the
			// credential opens goes client to vendor and never comes here.
			v1.Post("/realtime/client_secrets", openAIRealtimeSessionHandler(deps))
			v1.Get("/convai/conversation/get-signed-url", elevenLabsSignedURLHandler(deps))
			// ElevenLabs' own audio paths, mirrored for the same reason the
			// mint above is: an ElevenLabs SDK reaches them by base URL alone,
			// so a customer already using that SDK gets metering, budgets and
			// traces without rewriting their calls into the OpenAI shape the
			// /v1/audio routes take.
			v1.Post("/text-to-speech/{voice_id}", elevenLabsSpeechHandler(deps))
			v1.Post("/speech-to-text", elevenLabsTranscriptionHandler(deps))
			// The OpenAI socket reports its usage to the client, not to us, so
			// the client posts it back to close the session's spend record.
			v1.Post("/realtime/sessions/{session_id}/usage", realtimeUsageHandler(deps))
		})
	})

	// Gemini-native surface. gemini-cli (GOOGLE_GEMINI_BASE_URL) and the
	// @google/genai SDK POST to `/v1beta/models/{model}:generateContent`
	// and `:streamGenerateContent`. We raw-forward to Bifrost's Gemini
	// Passthrough endpoint, which prepends the provider's BaseURL and
	// swaps our VK secret for the real x-goog-api-key on the way out.
	// Any path under /v1beta (including :countTokens, :batchEmbedContents,
	// cachedContents/*) is accepted by the same handler.
	r.Route("/v1beta", func(v1beta chi.Router) {
		v1beta.Use(AuthMiddleware(deps.App.Auth()))
		v1beta.Use(DispatchMetaMiddleware())
		v1beta.Use(CustomerTraceMiddleware())
		v1beta.Use(TraceRegistryMiddleware(deps.TraceRegistry, deps.DefaultExportEndpoint))
		v1beta.HandleFunc("/*", geminiPassthroughHandler(deps))
	})

	// Internal control-plane channel — protected by a shared HMAC
	// secret (`LW_GATEWAY_INTERNAL_SECRET`). Currently used by the
	// LangWatch governance ingestion pipeline to validate and execute
	// OTTL statements over inbound OTLP payloads. See
	// `platform/app/ee/governance/services/activity-monitor/ottlGatewayClient.ts`
	// for the matching client.
	if deps.OTTLServer != nil {
		r.Route("/internal", func(in chi.Router) {
			in.Use(InternalAuthMiddleware(deps.InternalSecret))
			in.Post("/validate-ottl", deps.OTTLServer.HandleValidate)
			in.Post("/transform", deps.OTTLServer.HandleTransform)
		})
	}

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

		body, ok := readFullBody(deps.Logger, w, r, deps.MaxRequestBodyBytes)
		if !ok {
			return
		}

		model := app.PeekModel(body)
		if app.PeekStream(body) {
			result, err := deps.App.HandleChatStream(r.Context(), bundle, bytes.NewReader(body), model)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
		} else {
			result, hw, err := withHeartbeat(r.Context(), w, deps.HeartbeatInterval, func() (*app.CompletionResult, error) {
				return deps.App.HandleChat(r.Context(), bundle, bytes.NewReader(body), model)
			})
			if err != nil {
				writeError(deps.Logger, hw, r.Context(), err)
				return
			}
			setMetaHeaders(hw, result.Meta)
			writeJSONResponse(hw, result.Response)
		}
	}
}

func messagesHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}

		body, ok := readFullBody(deps.Logger, w, r, deps.MaxRequestBodyBytes)
		if !ok {
			return
		}

		// One-off DEBUG dump of the inbound /v1/messages body — enabled by
		// LW_LOG_MESSAGE_BODY=1. Lets operators see exactly what
		// claude-code / Anthropic SDK clients send when debugging
		// shape-specific provider rejections (e.g. fields that trigger
		// HTML 5xx from Anthropic's edge). Must NOT be left on in prod —
		// dumps full request content including potentially sensitive
		// prompts.
		if os.Getenv("LW_LOG_MESSAGE_BODY") == "1" {
			deps.Logger.Info("/v1/messages request body",
				zap.Int("body_bytes", len(body)),
				zap.String("body", string(body)),
			)
		}

		model := app.PeekModel(body)
		if app.PeekStream(body) {
			result, err := deps.App.HandleMessagesStream(r.Context(), bundle, bytes.NewReader(body), model)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
		} else {
			result, hw, err := withHeartbeat(r.Context(), w, deps.HeartbeatInterval, func() (*app.CompletionResult, error) {
				return deps.App.HandleMessages(r.Context(), bundle, bytes.NewReader(body), model)
			})
			if err != nil {
				writeError(deps.Logger, hw, r.Context(), err)
				return
			}
			setMetaHeaders(hw, result.Meta)
			writeJSONResponse(hw, result.Response)
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

		// codex 0.122+ and opencode send ~35-60 KiB bodies (full tool
		// schemas + multi-turn developer input arrays) where the top-level
		// `stream` field lands at the tail. Detecting it from a prefix peek
		// misroutes a streaming request through the non-streaming handler,
		// turns OpenAI's 200+SSE response into a Bifrost unmarshal failure,
		// and surfaces as a 502 with the SSE frames as the error body — so
		// scan the full body, not a fixed window.
		body, ok := readFullBody(deps.Logger, w, r, deps.MaxRequestBodyBytes)
		if !ok {
			return
		}

		// Same one-off DEBUG body dump as /v1/messages — gated on
		// LW_LOG_MESSAGE_BODY=1. Helpful for diagnosing codex/opencode
		// /v1/responses failures where Bifrost's adapter rejects
		// codex-shaped tools[] or other Responses-API features.
		if os.Getenv("LW_LOG_MESSAGE_BODY") == "1" {
			deps.Logger.Info("/v1/responses request body",
				zap.Int("body_bytes", len(body)),
				zap.String("body", string(body)),
			)
		}

		model := app.PeekModel(body)
		if app.PeekStream(body) {
			result, err := deps.App.HandleResponsesStream(r.Context(), bundle, bytes.NewReader(body), model)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
		} else {
			result, hw, err := withHeartbeat(r.Context(), w, deps.HeartbeatInterval, func() (*app.CompletionResult, error) {
				return deps.App.HandleResponses(r.Context(), bundle, bytes.NewReader(body), model)
			})
			if err != nil {
				writeError(deps.Logger, hw, r.Context(), err)
				return
			}
			setMetaHeaders(hw, result.Meta)
			writeJSONResponse(hw, result.Response)
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

		result, hw, err := withHeartbeat(r.Context(), w, deps.HeartbeatInterval, func() (*app.EmbeddingResult, error) {
			return deps.App.HandleEmbeddings(r.Context(), bundle, body, app.PeekModel(peek))
		})
		if err != nil {
			writeError(deps.Logger, hw, r.Context(), err)
			return
		}
		setMetaHeaders(hw, result.Meta)
		writeJSONResponse(hw, result.Response)
	}
}

// speechHandler terminates POST /v1/audio/speech (OpenAI-wire TTS). The
// request body is small JSON; the response body is binary audio whose
// Content-Type the dispatcher attached, so writeJSONResponse forwards it
// without a JSON envelope. Never streams.
func speechHandler(deps RouterDeps) http.HandlerFunc {
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

		result, hw, err := withHeartbeat(r.Context(), w, deps.HeartbeatInterval, func() (*app.CompletionResult, error) {
			return deps.App.HandleSpeech(r.Context(), bundle, body, app.PeekModel(peek))
		})
		if err != nil {
			writeError(deps.Logger, hw, r.Context(), err)
			return
		}
		setMetaHeaders(hw, result.Meta)
		writeJSONResponse(hw, result.Response)
	}
}

// maxTranscriptionBodyBytes caps a /v1/audio/transcriptions upload. OpenAI's
// own endpoint accepts at most 25 MB of audio; one extra MB covers multipart
// framing and the small text fields. Requests over the cap get 413 before any
// provider is contacted.
const maxTranscriptionBodyBytes = 26 << 20

// transcriptionFormFields are the OpenAI-wire optional text fields forwarded
// to the provider. Anything else in the form is dropped rather than sent
// blind.
var transcriptionFormFields = []string{"language", "prompt", "response_format", "temperature"}

// transcriptionsHandler terminates POST /v1/audio/transcriptions (OpenAI-wire
// multipart STT). Unlike every other v1 route the body is multipart/form-data,
// so the handler parses the form here, the only layer with the *http.Request,
// and hands the app a normalized upload. Never streams.
func transcriptionsHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}

		if err := prepareRequestBody(w, r, maxTranscriptionBodyBytes); err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}
		// Memory threshold: files up to 10 MB stay in memory, larger ones
		// spill to a temp file ParseMultipartForm cleans up on r.Body close.
		if err := r.ParseMultipartForm(10 << 20); err != nil {
			if bodyReadErrorCode(err) == domain.ErrPayloadTooLarge {
				writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrPayloadTooLarge, herr.M{
					"message": "audio upload exceeds the 25 MB transcription limit",
				}))
				return
			}
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"message": "malformed multipart/form-data body: " + err.Error(),
			}))
			return
		}

		file, header, err := r.FormFile("file")
		if err != nil {
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"message": `missing required multipart field: "file"`,
			}))
			return
		}
		defer func() { _ = file.Close() }()

		data, err := io.ReadAll(file)
		if err != nil {
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"message": "failed reading uploaded file: " + err.Error(),
			}))
			return
		}

		params := make(map[string]string, len(transcriptionFormFields))
		for _, f := range transcriptionFormFields {
			if v := r.FormValue(f); v != "" {
				params[f] = v
			}
		}
		upload := &domain.TranscriptionUpload{File: data, Filename: header.Filename, Params: params}

		result, hw, err := withHeartbeat(r.Context(), w, deps.HeartbeatInterval, func() (*app.CompletionResult, error) {
			return deps.App.HandleTranscription(r.Context(), bundle, upload, r.FormValue("model"))
		})
		if err != nil {
			writeError(deps.Logger, hw, r.Context(), err)
			return
		}
		setMetaHeaders(hw, result.Meta)
		writeJSONResponse(hw, result.Response)
	}
}

// maxRealtimeMintBodyBytes caps a session-mint body. An OpenAI session
// declaration carries instructions, a tool list and turn-detection settings;
// 256 KiB is far past any real one and well short of a payload worth
// forwarding to a vendor by mistake.
const maxRealtimeMintBodyBytes = 256 << 10

// openAIRealtimeSessionHandler terminates POST /v1/realtime/client_secrets,
// OpenAI's own mint path. The caller's session declaration is forwarded to
// OpenAI as they wrote it, with the resolved model written back into
// session.model, and the ephemeral secret comes back verbatim.
//
// The route states its own vendor through domain.OpenAIRealtimeSurface(). No
// other provider serves this wire, and the body carries a customer's
// instructions and tool definitions, so it must never reach a vendor the
// caller did not name.
func openAIRealtimeSessionHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		body, ok := readFullBody(deps.Logger, w, r, maxRealtimeMintBodyBytes)
		if !ok {
			return
		}
		if len(bytes.TrimSpace(body)) == 0 {
			body = []byte(`{}`)
		}
		model := gjson.GetBytes(body, "session.model").String()

		result, err := deps.App.HandleRealtimeSession(r.Context(), bundle, app.RealtimeMintDispatch{
			Body:    body,
			Model:   model,
			Session: domain.RealtimeSessionRequest{Vendor: domain.RealtimeVendorOpenAI},
			Surface: domain.OpenAIRealtimeSurface(),
		})
		if err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}
		setMetaHeaders(w, result.Meta)
		writeJSONResponse(w, result.Response)
	}
}

// elevenLabsSignedURLHandler terminates
// GET /v1/convai/conversation/get-signed-url, ElevenLabs' own mint path.
//
// The request carries no body, so the handler synthesizes one naming the
// catalog model this session bills under, the same way the transcription
// route does, and the body-reading stages of the pipeline see well-formed
// JSON instead of a query string.
func elevenLabsSignedURLHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		agentID := strings.TrimSpace(r.URL.Query().Get("agent_id"))
		if agentID == "" {
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"message": "agent_id query parameter is required: a signed URL is bound to one agent",
				"fault":   "customer",
			}))
			return
		}
		// Marshaled rather than concatenated: agent_id is a raw query
		// parameter, and strconv.Quote emits Go escapes such as \x01 for a
		// control byte, which is not JSON. Every stage downstream parses
		// this body.
		body, err := sonic.Marshal(map[string]string{
			"model":    domain.ElevenLabsConvAIModel,
			"agent_id": agentID,
		})
		if err != nil {
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrInternal, herr.M{
				"message": "could not build the session request body",
				"fault":   "gateway",
			}))
			return
		}

		result, err := deps.App.HandleRealtimeSession(r.Context(), bundle, app.RealtimeMintDispatch{
			Body:  body,
			Model: domain.ElevenLabsConvAIModel,
			Session: domain.RealtimeSessionRequest{
				Vendor:  domain.RealtimeVendorElevenLabs,
				AgentID: agentID,
			},
			Surface: domain.ElevenLabsConvAISurface(),
		})
		if err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}
		setMetaHeaders(w, result.Meta)
		writeJSONResponse(w, result.Response)
	}
}

// maxElevenLabsSpeechBodyBytes caps a native synthesis body. The vendor's own
// text limit is tens of thousands of characters, and the rest of the body is
// voice settings, so a megabyte is far past any real request and well short of
// a payload worth forwarding by mistake.
const maxElevenLabsSpeechBodyBytes = 1 << 20

// maxElevenLabsUploadBytes caps a native transcription upload, at the same
// 26 MB the OpenAI-wire transcription route uses so the two audio routes agree.
//
// It is its own constant rather than the gateway-wide request ceiling because
// this upload is held in memory twice: once as the parsed file, and again in
// the multipart body rebuilt for the vendor, for as long as the vendor call
// runs. The vendor accepts far larger files, and a caller who has one sends a
// cloud_storage_url part instead, which ElevenLabs fetches itself and which
// costs this process nothing.
const maxElevenLabsUploadBytes = maxTranscriptionBodyBytes

// elevenLabsSpeechHandler terminates POST /v1/text-to-speech/{voice_id},
// ElevenLabs' own synthesis path.
//
// The body reaches the vendor as the caller wrote it. Only the model is read
// here, so the virtual key's aliases, allowlist, budgets and spend record all
// apply to it, and the response is the vendor's audio bytes unchanged.
func elevenLabsSpeechHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		body, ok := readFullBody(deps.Logger, w, r, maxElevenLabsSpeechBodyBytes)
		if !ok {
			return
		}
		if gjson.GetBytes(body, "text").String() == "" {
			writeError(deps.Logger, w, r.Context(), herr.New(r.Context(), domain.ErrBadRequest, herr.M{
				"message": `text is required: ElevenLabs synthesis takes the text to speak in a top-level "text" field`,
				"fault":   "customer",
			}))
			return
		}
		// Absent means the vendor's own default, so the gateway names that
		// model rather than leaving the request unmetered and ungated.
		model := gjson.GetBytes(body, domain.ElevenLabsModelField).String()
		if model == "" {
			model = domain.ElevenLabsDefaultSpeechModel
		}

		result, hw, err := withHeartbeat(r.Context(), w, deps.HeartbeatInterval, func() (*app.CompletionResult, error) {
			return deps.App.HandleElevenLabsSpeech(r.Context(), bundle, app.ElevenLabsAudioDispatch{
				Model: model,
				Body:  body,
				Route: domain.ElevenLabsAudioRequest{
					VoiceID:  chi.URLParam(r, "voice_id"),
					RawQuery: r.URL.RawQuery,
				},
			})
		})
		if err != nil {
			writeError(deps.Logger, hw, r.Context(), err)
			return
		}
		setMetaHeaders(hw, result.Meta)
		writeJSONResponse(hw, result.Response)
	}
}

// elevenLabsTranscriptionHandler terminates POST /v1/speech-to-text,
// ElevenLabs' own transcription path.
//
// Multipart like the OpenAI-wire transcription route, and parsed here for the
// same reason: this is the only layer holding the *http.Request. Every text
// part is carried through to the vendor rather than filtered to a known list,
// because on a route that mirrors a vendor's own path the caller's settings
// are the request.
func elevenLabsTranscriptionHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		upload, ok := parseElevenLabsUpload(deps, w, r)
		if !ok {
			return
		}
		// Not defaulted: ElevenLabs has no default transcription model, so a
		// request without one is incomplete and guessing would bill a model
		// the caller never chose. An empty value is refused by the resolver,
		// which is the one place that says where each surface names its model.
		result, hw, err := withHeartbeat(r.Context(), w, deps.HeartbeatInterval, func() (*app.CompletionResult, error) {
			return deps.App.HandleElevenLabsTranscription(r.Context(), bundle, app.ElevenLabsAudioDispatch{
				Model:  upload.Params[domain.ElevenLabsModelField],
				Upload: upload,
				Route:  domain.ElevenLabsAudioRequest{RawQuery: r.URL.RawQuery},
			})
		})
		if err != nil {
			writeError(deps.Logger, hw, r.Context(), err)
			return
		}
		setMetaHeaders(hw, result.Meta)
		writeJSONResponse(hw, result.Response)
	}
}

// parseElevenLabsUpload reads the native transcription form into the shared
// upload shape.
//
// The audio part is optional, because this vendor also accepts a
// cloud_storage_url it fetches itself; a request with neither is refused here
// rather than at the vendor. The size cap is the gateway's own request
// ceiling: the vendor accepts far larger files through that URL, and a
// multi-gigabyte upload through this process is not something to hold in
// memory.
func parseElevenLabsUpload(deps RouterDeps, w http.ResponseWriter, r *http.Request) (*domain.TranscriptionUpload, bool) {
	if err := readElevenLabsForm(w, r); err != nil {
		writeError(deps.Logger, w, r.Context(), err)
		return nil, false
	}
	upload, err := elevenLabsUploadFromForm(r)
	if err != nil {
		writeError(deps.Logger, w, r.Context(), err)
		return nil, false
	}
	return upload, true
}

// readElevenLabsForm caps the body and parses the multipart envelope.
func readElevenLabsForm(w http.ResponseWriter, r *http.Request) error {
	maxBytes := int64(maxElevenLabsUploadBytes)
	if err := prepareRequestBody(w, r, maxBytes); err != nil {
		return err
	}
	// Memory threshold: parts up to 10 MB stay in memory, larger ones spill to
	// a temp file ParseMultipartForm cleans up on r.Body close.
	//nolint:gosec // G120: prepareRequestBody already wrapped r.Body in a MaxBytesReader at maxBytes
	if err := r.ParseMultipartForm(10 << 20); err != nil {
		if bodyReadErrorCode(err) == domain.ErrPayloadTooLarge {
			return herr.New(r.Context(), domain.ErrPayloadTooLarge, herr.M{
				"message": fmt.Sprintf(
					"the audio upload exceeds this gateway's %d byte limit; "+
						"send a cloud_storage_url part instead for a file this large", maxBytes),
			})
		}
		return herr.New(r.Context(), domain.ErrBadRequest, herr.M{
			"message": "malformed multipart/form-data body: " + err.Error(),
		})
	}
	return nil
}

// elevenLabsUploadFromForm lifts the parsed form into the shared upload shape.
func elevenLabsUploadFromForm(r *http.Request) (*domain.TranscriptionUpload, error) {
	upload := &domain.TranscriptionUpload{Params: elevenLabsFormValues(r)}
	if err := refuseElevenLabsAsyncTranscription(r, upload.Params); err != nil {
		return nil, err
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		// No audio uploaded is a complete request when the caller named a
		// cloud_storage_url, which this vendor fetches itself.
		if upload.Params["cloud_storage_url"] != "" {
			return upload, nil
		}
		return nil, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
			"message": `missing audio: send a "file" part, or a "cloud_storage_url" part for the provider to fetch`,
			"fault":   "customer",
		})
	}
	defer func() { _ = file.Close() }()
	data, err := io.ReadAll(file)
	if err != nil {
		return nil, herr.New(r.Context(), domain.ErrBadRequest, herr.M{
			"message": "failed reading uploaded file: " + err.Error(),
		})
	}
	upload.File = data
	upload.Filename = header.Filename
	return upload, nil
}

// elevenLabsFormValues collects every text part the caller sent. They are all
// carried through rather than filtered to a known list, because on a route
// that mirrors a vendor's own path the caller's settings are the request, and
// an allowlist goes stale the moment the vendor adds a parameter.
func elevenLabsFormValues(r *http.Request) map[string]string {
	values := map[string]string{}
	if r.MultipartForm == nil {
		return values
	}
	for name, part := range r.MultipartForm.Value {
		if len(part) > 0 {
			values[name] = part[0]
		}
	}
	return values
}

// refuseElevenLabsAsyncTranscription rejects the vendor's own asynchronous
// mode on this route.
//
// With a webhook part, ElevenLabs answers before it has transcribed anything
// and delivers the result to a workspace webhook later. That first answer
// carries no duration and no word timings, so the call would confirm its spend
// record at zero seconds and bill nothing for audio the customer was charged
// for. The gateway has no settlement path for those deliveries either: the
// existing /v1/convai/webhook relay is for Conversational AI post-call
// reports, which are a different payload keyed on a different id.
//
// Refusing says so, rather than billing zero and looking like it worked. The
// synchronous request the caller can send instead is the one line of the fix.
func refuseElevenLabsAsyncTranscription(r *http.Request, params map[string]string) error {
	// The vendor names this parameter "webhook" and reports it back as
	// `"param": "webhook"` on its own validation errors (measured against the
	// live API, 2026-08-21). Any truthy spelling is refused, because the
	// spelling that gets through is the one that bills nothing.
	if value, ok := params["webhook"]; !ok || !isTruthyFormValue(value) {
		return nil
	}
	return herr.New(r.Context(), domain.ErrBadRequest, herr.M{
		"message": "webhook=true is not supported on this gateway route: the vendor answers " +
			"before it has transcribed anything, so the call carries no duration to bill. " +
			"Send the request without the webhook part and read the transcript from the response",
		"fault": "customer",
	})
}

// isTruthyFormValue reads a boolean the way a form part spells one.
func isTruthyFormValue(value string) bool {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "true", "1", "yes", "on":
		return true
	default:
		return false
	}
}

// maxRealtimeUsageBodyBytes caps a usage report. It is one usage object.
const maxRealtimeUsageBodyBytes = 64 << 10

// realtimeUsageHandler terminates
// POST /v1/realtime/sessions/{session_id}/usage.
//
// OpenAI reports a realtime session's usage over the socket, in
// response.done, and that socket runs client to vendor. The client posts
// what it read back here, and the control plane closes the session's spend
// record with it.
//
// Deliberately outside the dispatch pipeline: this is a report about a
// request that was already admitted, not a new one. Running it through the
// chain would admit a second spend record, and the report itself calls no
// provider, so there is nothing for a budget or a guardrail to gate.
func realtimeUsageHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}
		sessionID := chi.URLParam(r, "session_id")
		body, ok := readFullBody(deps.Logger, w, r, maxRealtimeUsageBodyBytes)
		if !ok {
			return
		}
		report := app.RealtimeUsagePost{SessionID: sessionID, Body: body}
		if err := deps.App.ReportRealtimeUsage(r.Context(), bundle, report); err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"received":true}`))
	}
}

// elevenLabsWebhookHandler terminates
// POST /v1/convai/webhook/{model_provider_id}, the URL a customer pastes into
// their own ElevenLabs dashboard (ADR-097).
//
// It relays and nothing else. The body is streamed to the control plane
// exactly as received, because the vendor's HMAC covers those raw bytes and
// any re-encoding here would fail every delivery. The gateway does not parse
// the body, does not hold the tenant's secret, and does not decide whether the
// delivery is genuine.
//
// A failure to reach the control plane answers 502, which is deliberate even
// though the vendor may not retry. Acknowledging a delivery this gateway never
// passed on would tell the vendor the report landed when it did not, and the
// count of consecutive failures is what eventually disables the webhook, so
// hiding them removes the only signal that the relay is broken. Nothing is
// lost by the honest answer: the reconciler reads the same numbers back from
// the vendor on its own schedule and bills the call regardless.
func elevenLabsWebhookHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		result, err := deps.WebhookRelay.ForwardElevenLabsWebhook(
			r.Context(),
			controlplane.WebhookRelay{
				ModelProviderID: chi.URLParam(r, "model_provider_id"),
				Signature:       r.Header.Get("ElevenLabs-Signature"),
				ContentType:     r.Header.Get("Content-Type"),
				Body:            r.Body,
			},
		)
		if err != nil {
			// An oversized delivery is the caller's shape, not our outage,
			// and relaying a truncated one would fail its own HMAC and read
			// as a forgery. 413 says which it is.
			if errors.Is(err, controlplane.ErrWebhookTooLarge) {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusRequestEntityTooLarge)
				_, _ = w.Write([]byte(`{"error":"the delivery is too large to relay"}`))
				return
			}
			deps.Logger.Warn("an ElevenLabs post-call delivery could not be relayed to the control plane",
				zap.Error(err))
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadGateway)
			_, _ = w.Write([]byte(`{"error":"the delivery could not be relayed"}`))
			return
		}
		// The control plane's own status, unchanged: 404 keeps provider ids
		// unprobeable, 401 is a real signature failure, and 200 is an
		// acknowledgement it issued rather than one this hop invented.
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(result.StatusCode)
		_, _ = w.Write(result.Body)
	}
}

// geminiPassthroughHandler terminates any POST /v1beta/... request.
// Specifically targets the Gemini-native shape used by gemini-cli
// (`GOOGLE_GEMINI_BASE_URL=http://…/gateway`) and the @google/genai
// SDK: `/v1beta/models/{model}:generateContent` and its streaming
// sibling `:streamGenerateContent`. Raw-forwards body, method, and
// query to Bifrost's Gemini Passthrough; client auth (already parsed
// via x-goog-api-key or Authorization: Bearer in the middleware) maps
// to the VK's Gemini provider credential inside Bifrost. The gateway
// doesn't translate body shape — the upstream response is proxied
// back verbatim. Streaming paths get raw SSE chunks (upstream already
// emits `event:`/`data:` framing).
//
// The handler states its own vendor through domain.GeminiSurface(). The
// model id comes from the URL path and so carries no provider prefix; left
// to the credential chain, a key with no Google credential forwarded the
// body to whichever vendor came first.
func geminiPassthroughHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}

		// Match chat/responses — bodies from coding-agent clients run 30-60 KiB
		// and we must fit flags like action suffix discovery into the peek.
		peek, body, release, ok := readAndPeekBodyLarge(w, r, deps.MaxRequestBodyBytes)
		if !ok {
			return
		}
		defer release()

		path := strings.TrimPrefix(r.URL.Path, "/v1beta")
		if path == "" {
			path = "/"
		}
		model := geminiModelFromPath(path)
		isStream := strings.HasSuffix(path, ":streamGenerateContent") ||
			strings.HasSuffix(path, ":streamGenerateAnswer")
		_ = peek // body peek not needed beyond MaterializeBody; kept for parity

		meta := domain.PassthroughRequest{
			Method:   r.Method,
			Path:     path,
			RawQuery: r.URL.RawQuery,
			Headers:  forwardedPassthroughHeaders(r.Header),
			Stream:   isStream,
		}
		dispatch := app.PassthroughDispatch{
			Body:    body,
			Model:   model,
			Meta:    meta,
			Surface: domain.GeminiSurface(),
		}

		if isStream {
			result, err := deps.App.HandlePassthroughStream(r.Context(), bundle, dispatch)
			if err != nil {
				writeError(deps.Logger, w, r.Context(), err)
				return
			}
			setMetaHeaders(w, result.Meta)
			writeSSE(r.Context(), w, result.Iterator)
			return
		}

		result, hw, err := withHeartbeat(r.Context(), w, deps.HeartbeatInterval, func() (*app.CompletionResult, error) {
			return deps.App.HandlePassthrough(r.Context(), bundle, dispatch)
		})
		if err != nil {
			writeError(deps.Logger, hw, r.Context(), err)
			return
		}
		setMetaHeaders(hw, result.Meta)
		writeJSONResponse(hw, result.Response)
	}
}

// geminiModelFromPath extracts the model id from a Gemini path like
// `/models/gemini-2.5-flash:generateContent`. Returns "" when the path
// doesn't contain a `/models/<id>:<action>` segment (e.g. cachedContents
// or tuning endpoints where model-by-URL isn't the convention).
func geminiModelFromPath(path string) string {
	const prefix = "/models/"
	i := strings.Index(path, prefix)
	if i < 0 {
		return ""
	}
	rest := path[i+len(prefix):]
	if j := strings.IndexByte(rest, ':'); j >= 0 {
		return rest[:j]
	}
	if j := strings.IndexByte(rest, '/'); j >= 0 {
		return rest[:j]
	}
	return rest
}

// forwardedPassthroughHeaders selects client headers safe to forward
// upstream. Authorization + x-api-key + x-goog-api-key are dropped (the
// gateway already resolved the VK secret and Bifrost injects the real
// provider key). Hop-by-hop headers are dropped per RFC 7230 §6.1.
func forwardedPassthroughHeaders(h http.Header) map[string]string {
	if len(h) == 0 {
		return nil
	}
	out := make(map[string]string, len(h))
	for k, vals := range h {
		if len(vals) == 0 {
			continue
		}
		switch strings.ToLower(k) {
		case "authorization",
			"x-api-key",
			"x-goog-api-key",
			"host",
			"content-length",
			"connection",
			"proxy-authorization",
			"proxy-connection",
			"te",
			"trailer",
			"transfer-encoding",
			"upgrade",
			"keep-alive":
			continue
		}
		out[k] = vals[0]
	}
	return out
}

func modelsHandler(deps RouterDeps) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bundle, ok := requireBundle(w, r, deps.Logger)
		if !ok {
			return
		}

		models, gaps, err := deps.App.ListModels(r.Context(), bundle)
		if err != nil {
			writeError(deps.Logger, w, r.Context(), err)
			return
		}

		// Discovery gaps make an empty or partial list diagnosable from
		// the response itself: a provider the key can dispatch to that
		// contributed no models is named here with the reason, instead of
		// silently reading as "no models". A header rather than a body
		// field so the payload stays exactly the OpenAI list shape.
		if len(gaps) > 0 {
			w.Header().Set("X-Langwatch-Models-Discovery-Incomplete", formatDiscoveryGaps(gaps))
		}

		// OpenAI list shape: model-picker clients (OpenWebUI, LibreChat,
		// SDKs) expect every field of the Model object and an always-
		// present data array (null breaks some parsers). `created` and
		// `owned_by` are required by the OpenAI SDK types, so omitting
		// them leaves strict clients with a null where they expect an
		// int / string.
		data := make([]map[string]any, 0, len(models))
		for _, m := range models {
			data = append(data, map[string]any{
				"id":     m.ID,
				"object": "model",
				// A gateway model list has no creation date to report:
				// aliases are config, and upstream catalogs rarely carry
				// one. 0 keeps the field present and typed rather than
				// inventing a timestamp that would churn on every call.
				"created":  0,
				"owned_by": modelOwnedBy(m),
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = sonic.ConfigDefault.NewEncoder(w).Encode(map[string]any{
			"object": "list",
			"data":   data,
		})
	}
}

// modelOwnedBy names the owner of a listed model. Models that carry no
// provider (an allowlist entry on a multi-provider credential chain, for
// instance) are attributed to the gateway rather than to an empty string:
// `owned_by` is a required string in the OpenAI Model object, and a
// blank one renders as an unlabelled row in model pickers.
//
// This stays the provider FAMILY even for an instance carrying a routing
// handle. `owned_by` is the vendor a client groups the picker by, so putting
// a handle here would file an Anthropic model under "europe". The handle
// belongs in the id, which is what a caller sends, and Model.ListingSpelling
// puts it there.
func modelOwnedBy(m domain.Model) string {
	if m.ProviderID == "" {
		return "langwatch"
	}
	return string(m.ProviderID)
}

// formatDiscoveryGaps renders gaps as "provider:reason" tokens, comma
// separated ("bedrock:not-enumerable,openai:probe-failed"). The adapter
// returns them deduped and sorted, so the header is deterministic.
func formatDiscoveryGaps(gaps []domain.ModelDiscoveryGap) string {
	tokens := make([]string, 0, len(gaps))
	for _, gap := range gaps {
		tokens = append(tokens, string(gap.ProviderID)+":"+string(gap.Reason))
	}
	return strings.Join(tokens, ",")
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

// Prefix-peek sizes for endpoints that do NOT decide streaming from a
// body field: /v1/embeddings (never streams) uses the 32 KiB default,
// and the Gemini passthrough (streaming decided by the URL suffix, peek
// only locates the model) uses the 256 KiB variant for its larger
// generate-content bodies. The chat / messages / responses dispatch
// endpoints do NOT use these — they read the full body (readFullBody)
// because their top-level `stream` flag lands at the tail, past any
// fixed window, and a miss misroutes a streaming request to the
// non-streaming handler (502 SSE-in-error-body).
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

// readFullBody materializes the entire request body (capped at maxBytes)
// so stream/model detection scans the whole payload instead of a prefix.
// The top-level `stream` flag on chat / messages / responses bodies sits
// at the tail, after the unbounded messages/input array — Claude Code
// emits it dead last and its offset grows with every conversation turn,
// so any fixed-size peek window misses it once the body outgrows the
// window. A miss routes a streaming request through the non-streaming
// handler; the provider answers 200+SSE, Bifrost cannot unmarshal the
// SSE frames as a single JSON object, and the client gets a 502 with the
// SSE as the error body. The body is read in full to forward upstream
// regardless, so scanning all of it adds no extra I/O on the hot path.
func readFullBody(logger *zap.Logger, w http.ResponseWriter, r *http.Request, maxBytes int64) ([]byte, bool) {
	ctx := r.Context()
	if maxBytes <= 0 {
		maxBytes = config.DefaultMaxRequestBodyBytes
	}
	if err := prepareRequestBody(w, r, maxBytes); err != nil {
		writeError(logger, w, ctx, err)
		return nil, false
	}
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(logger, w, ctx, herr.New(ctx, bodyReadErrorCode(err), herr.M{"message": err.Error()}))
		return nil, false
	}
	return body, true
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
	if err := prepareRequestBody(w, r, maxBytes); err != nil {
		writeError(clog.Get(r.Context()), w, r.Context(), err)
		return nil, nil, func() {}, false
	}

	peeked := make([]byte, peekSize)
	n, err := io.ReadFull(r.Body, peeked)
	// A body shorter than the peek window is the normal case and reports EOF.
	// Any other failure comes from the decoder or one of the size ceilings, and
	// swallowing it would peek at a truncated payload and then surface the real
	// cause as a downstream application error instead of a 400 / 413.
	if err != nil && !errors.Is(err, io.EOF) && !errors.Is(err, io.ErrUnexpectedEOF) {
		writeError(clog.Get(r.Context()), w, r.Context(),
			herr.New(r.Context(), bodyReadErrorCode(err), herr.M{"message": err.Error()}))
		return nil, nil, func() {}, false
	}
	peeked = peeked[:n]

	buf := bodyPool.Get().(*bytes.Buffer)
	body := io.MultiReader(bytes.NewReader(peeked), r.Body)

	// Since we need to materialize for bifrost anyway, we still use the pool
	// but we only fill it if/when MaterializeBody is called in the pipeline.
	// For now, to keep it simple and satisfy the "staged approach", we pass
	// a reader that will fill the pooled buffer when read.

	var once sync.Once
	materializedBody := &lazyPooledBody{
		ctx:    r.Context(),
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
	ctx     context.Context
	reader  io.Reader
	buf     *bytes.Buffer
	release func()
}

func (l *lazyPooledBody) Read(p []byte) (n int, err error) {
	n, err = l.reader.Read(p)
	if n > 0 {
		l.buf.Write(p[:n])
	}
	// This reader is handed to the application pipeline, which materializes it
	// well past the transport. The rest of the body can still fail there — a
	// decoded payload only crosses its ceiling once enough of it has been read
	// — and an unclassified error at that depth answers 500 instead of the
	// 400 / 413 the transport already knows the request earned. Classifying it
	// as a herr here keeps that answer intact: MaterializeBody wraps with %w,
	// so writeError still unwraps to the gateway code.
	if err != nil && !errors.Is(err, io.EOF) {
		return n, herr.New(l.ctx, bodyReadErrorCode(err), herr.M{"message": err.Error()})
	}
	return n, err
}

// heartbeatByte is a single RFC 8259 §2 insignificant-whitespace byte.
// Every conformant JSON parser skips whitespace before the top-level
// value, so writing one periodically keeps the connection producing bytes
// without corrupting the eventual response body.
var heartbeatByte = []byte{' '}

// heartbeatWriter tracks whether anything has reached the transport yet.
// Once a heartbeat has flushed, the HTTP status is irrevocably committed
// (net/http sends an implicit 200 on the first Write); a later real
// WriteHeader call from writeError/writeJSONResponse would otherwise log a
// "superfluous WriteHeader" warning for no effect, so it's turned into a
// harmless no-op here — the body write immediately after it still goes
// through and reaches the client normally.
type heartbeatWriter struct {
	http.ResponseWriter
	started bool
}

func (h *heartbeatWriter) WriteHeader(statusCode int) {
	if h.started {
		return
	}
	h.started = true
	h.ResponseWriter.WriteHeader(statusCode)
}

func (h *heartbeatWriter) Write(p []byte) (int, error) {
	h.started = true
	return h.ResponseWriter.Write(p)
}

func (h *heartbeatWriter) Flush() {
	if f, ok := h.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (h *heartbeatWriter) Unwrap() http.ResponseWriter {
	return h.ResponseWriter
}

// withHeartbeat runs dispatch on a background goroutine and, while it is
// still in flight, periodically writes a heartbeat byte to w and flushes
// it. This resets the idle-connection timer of any proxy/CDN sitting in
// front of the gateway (e.g. Cloudflare's ~100s default) so a large-context
// completion that legitimately runs long doesn't go silent long enough to
// get killed before it can finish. See
// specs/ai-gateway/non-streaming-time-to-first-byte.feature and
// https://github.com/langwatch/langwatch/issues/4806.
//
// Requests that finish inside the first interval are byte-for-byte
// unaffected — the returned writer just proxies to w. Once a heartbeat has
// fired, the HTTP status is irrevocably committed to 200 (the same
// trade-off the streaming path already accepts for errors that surface
// mid-stream — see streaming.feature): if dispatch ultimately errors after
// heartbeating has started, the caller's writeError call still produces
// the correct structured error body via the returned writer, but the wire
// status can no longer be changed to the real 4xx/5xx. A client that
// checks the response body (not just the status) still gets the accurate
// error. interval of zero resolves to config.DefaultNonStreamingHeartbeatInterval;
// negative disables heartbeating entirely.
//
// dispatch runs on a background goroutine so the select loop below stays
// free to write heartbeats while it's in flight. That goroutine is outside
// httpmiddleware.Recover()'s reach — Recover's defer/recover only guards
// the goroutine that calls ServeHTTP, not one spawned from inside a
// handler — so a panic in dispatch is recovered here explicitly and turned
// into the same internal_error 500 Recover() would have produced for a
// synchronous panic, instead of crashing the whole process.
func withHeartbeat[T any](ctx context.Context, w http.ResponseWriter, interval time.Duration, dispatch func() (T, error)) (T, http.ResponseWriter, error) {
	hw := &heartbeatWriter{ResponseWriter: w}

	type outcome struct {
		val T
		err error
	}
	resultCh := make(chan outcome, 1)
	go func() {
		defer func() {
			if v := recover(); v != nil {
				clog.LogPanic(ctx, v)
				var zero T
				resultCh <- outcome{val: zero, err: herr.New(ctx, domain.ErrInternal, nil)}
			}
		}()
		val, err := dispatch()
		resultCh <- outcome{val, err}
	}()

	if interval == 0 {
		interval = config.DefaultNonStreamingHeartbeatInterval
	}
	if interval <= 0 {
		r := <-resultCh
		return r.val, hw, r.err
	}

	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	heartbeatFired := false
	for {
		select {
		case r := <-resultCh:
			return r.val, hw, r.err
		case <-ticker.C:
			if !heartbeatFired {
				heartbeatFired = true
				// Every non-streaming JSON response is application/json
				// whatever the eventual outcome — set it before the first
				// heartbeat write so it's still part of the header block if
				// this response commits early. writeJSONResponse still
				// overwrites this with the more precise upstream content
				// type for the common (fast, no-heartbeat) case.
				hw.Header().Set("Content-Type", "application/json")
				// Once a heartbeat fires, status 200 is committed even if
				// dispatch later errors — there is no way to change it
				// after bytes are on the wire. This header is the only way
				// a client can distinguish "this 200 is real" from "this
				// 200 is a committed-early status masking a later error,
				// check the body for an error key." Tied to the first
				// actual heartbeat tick, not just to heartbeating being
				// enabled — every request has interval > 0 by default, so
				// setting this any earlier would put it on every response
				// regardless of whether a heartbeat ever fired, making it
				// useless as a signal.
				hw.Header().Set("X-LangWatch-Heartbeat-Active", "true")
				// Last chance to send response metadata: the write below
				// commits the header block, so anything the handler adds
				// after dispatch returns is silently dropped. Everything the
				// interceptor chain decides before the provider call —
				// budget warnings, cache mode, request id — is already
				// accumulated, and a long enough call to heartbeat is
				// exactly when a customer needs to see it.
				if meta := app.DispatchMetaFrom(ctx); meta != nil {
					setMetaHeaders(hw, meta.Snapshot())
				}
			}
			_, _ = hw.Write(heartbeatByte)
			hw.Flush()
		}
	}
}

func writeJSONResponse(w http.ResponseWriter, resp *domain.Response) {
	// Forward upstream headers when the dispatcher attached them (Gemini
	// passthrough path). Content-Type rides through so Google's
	// `application/json; charset=UTF-8` reaches the client untouched;
	// Content-Length is already stripped by the dispatcher because our
	// body may differ from what upstream framed.
	ct := "application/json"
	for k, v := range resp.Headers {
		if strings.EqualFold(k, "Content-Type") {
			ct = v
			continue
		}
		w.Header().Set(k, v)
	}
	w.Header().Set("Content-Type", ct)
	// A provider must not be able to make its body look LangWatch-authored —
	// same rule as writeUpstreamError. This lane forwards resp.Headers
	// wholesale, so an upstream echoing this header must not survive.
	w.Header().Del(herr.HandledErrorHeader)
	if resp.StatusCode > 0 {
		w.WriteHeader(resp.StatusCode)
	}
	_, _ = w.Write(resp.Body)
}

// setMetaHeaders writes the response metadata headers. Called up to twice per
// non-streaming request — once from the keep-alive before it commits the
// header block, once after dispatch returns — so it Sets rather than Adds and
// the second call refreshes the values instead of appending duplicates.
func setMetaHeaders(w http.ResponseWriter, meta app.DispatchMeta) {
	h := w.Header()
	if meta.GatewayRequestID != "" {
		h.Set("X-LangWatch-Gateway-Request-Id", meta.GatewayRequestID)
	}
	if meta.FallbackCount > 0 {
		h.Set("X-LangWatch-Fallback-Count", strconv.Itoa(meta.FallbackCount))
	}
	if len(meta.BudgetWarnings) > 0 {
		h.Set("X-LangWatch-Budget-Warning", strings.Join(meta.BudgetWarnings, ","))
	}
	if meta.CacheMode != "" {
		h.Set("X-LangWatch-Cache-Mode", meta.CacheMode)
	}
	if len(meta.ParamsDropped) > 0 {
		h.Set("X-LangWatch-Params-Dropped", strings.Join(meta.ParamsDropped, ","))
	}
	if meta.CustomerTraceparent != "" {
		h.Set("Traceparent", meta.CustomerTraceparent)
	}
	if meta.GuardrailsNotApplied != "" {
		h.Set("X-LangWatch-Guardrails-Not-Applied", meta.GuardrailsNotApplied)
	}
	if meta.RealtimeSessionID != "" {
		h.Set("X-LangWatch-Session-Id", meta.RealtimeSessionID)
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

// streamErrorFrame builds the data payload for a terminal `event: error`.
// SDK clients (OpenAI Responses, Vercel AI SDK) schema-validate every data
// payload, so the frame must be the documented error-event OBJECT, a bare
// string under an "error" key matches nothing and crashes the client with a
// parse error instead of surfacing the failure.
//
// Provider-origin errors that carried their own event body (UpstreamError
// with Body, e.g. OpenAI's mid-stream {"type":"error","error":{...}}) are
// forwarded verbatim: the gateway is a conduit, not an error rewriter
// (specs/ai-gateway/error-transparency.feature). Everything else gets the
// standard {"type":"error","error":{"type":"provider_error","message":...}}
// object.
func streamErrorFrame(err error) []byte {
	var ue *domain.UpstreamError
	if errors.As(err, &ue) && len(ue.Body) > 0 && sonic.Valid(ue.Body) {
		return ue.Body
	}
	msg := err.Error()
	errType := "provider_error"
	if ue != nil {
		if ue.Message != "" {
			msg = ue.Message
		}
		// Keep the provider's own error discriminant when the adapter parsed
		// one, so SDK clients that dispatch on error.type still recognize
		// e.g. insufficient_quota without the native event body.
		if ue.ErrorType != "" {
			errType = ue.ErrorType
		} else if ue.ErrorCode != "" {
			errType = ue.ErrorCode
		}
	}
	frame, marshalErr := sonic.Marshal(sseErrorPayload{
		Type:  "error",
		Error: sseErrorDetail{Type: errType, Message: msg},
	})
	if marshalErr != nil {
		return []byte(`{"type":"error","error":{"type":"provider_error","message":"stream failed"}}`)
	}
	return frame
}

type sseErrorPayload struct {
	Type  string         `json:"type"`
	Error sseErrorDetail `json:"error"`
}

type sseErrorDetail struct {
	Type    string `json:"type"`
	Message string `json:"message"`
}

func writeSSE(ctx context.Context, w http.ResponseWriter, iter domain.StreamIterator) {
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	w.WriteHeader(http.StatusOK)

	flusher, _ := w.(http.Flusher)

	// Passthrough streams (Gemini streamGenerateContent) yield chunks
	// that already contain fully-framed SSE bytes from upstream —
	// forward verbatim, don't re-wrap in another `data: …\n\n` envelope
	// or append a `[DONE]` trailer (Google doesn't use one).
	raw := false
	if rf, ok := iter.(domain.RawFramer); ok {
		raw = rf.RawFraming()
	}

	for iter.Next(ctx) {
		chunk := iter.Chunk()
		if raw {
			_, _ = w.Write(chunk)
		} else {
			_, _ = w.Write(sseDataPrefix)
			_, _ = w.Write(chunk)
			_, _ = w.Write(sseDoubleNL)
		}
		if flusher != nil {
			flusher.Flush()
		}
	}

	if err := iter.Err(); err != nil {
		_, _ = w.Write(sseErrorPrefix)
		_, _ = w.Write(streamErrorFrame(err))
		_, _ = w.Write(sseDoubleNL)
		if flusher != nil {
			flusher.Flush()
		}
	}

	if !raw && iter.Usage().TotalTokens == 0 {
		warnJSON, _ := sonic.Marshal(map[string]string{"warning": "provider_did_not_report_usage_on_stream"})
		_, _ = w.Write(sseWarnPrefix)
		_, _ = w.Write(warnJSON)
		_, _ = w.Write(sseDoubleNL)
	}

	if !raw {
		_, _ = w.Write(sseDone)
	}
	if flusher != nil {
		flusher.Flush()
	}

	_ = iter.Close()
}

// writeError sends a herr directly to the client. For unexpected (non-herr)
// errors it logs the details and returns a generic internal error.
func writeError(logger *zap.Logger, w http.ResponseWriter, ctx context.Context, err error) {
	// Every error response is logged with fault attribution before it is
	// written, so failures are visible in CloudWatch even when the response
	// correctly forwards the provider's error to the client.
	logWriteError(logger, ctx, err)
	var ue *domain.UpstreamError
	if errors.As(err, &ue) {
		writeUpstreamError(w, ue)
		return
	}
	var e herr.E
	if errors.As(err, &e) {
		herr.WriteHTTP(w, domain.Remediate(withFault(e)))
		return
	}
	herr.WriteHTTP(w, domain.Remediate(withFault(herr.New(ctx, domain.ErrInternal, nil))))
}

// withFault stamps the error's fault attribution onto the envelope, from the
// one fault table the log line already uses.
//
// Attribution has to travel WITH the error. The gateway authors most of its
// failures rather than forwarding a provider response, so there is no upstream
// status for a client, an agent or a support conversation to infer "whose
// problem is this" from. Doing it here, at the single write choke point, is
// what makes it impossible for a gateway error to reach a client unattributed
// — and keeps faultForCode as the only place the question is answered, rather
// than asking every construction site to remember.
//
// An explicit fault already in meta wins: a construction site that knows
// better than the code-level default (budget.go, classifyRequestBuildError)
// has said so deliberately.
func withFault(e herr.E) herr.E {
	if _, ok := e.Meta["fault"]; ok {
		return e
	}
	meta := make(herr.M, len(e.Meta)+1)
	for k, v := range e.Meta {
		meta[k] = v
	}
	meta["fault"] = string(faultForCode(e.Code))
	e.Meta = meta
	return e
}

// writeUpstreamError forwards a provider's terminal response to the client.
// The provider's native error body is written byte-for-byte when present, so
// the client sees the exact upstream envelope under the upstream's real
// status code (not a masked 502) and can tell terminal from retryable. When
// the native body is unavailable, the minimal envelope still preserves the
// error's identity: the provider's own error type/code (insufficient_quota,
// overloaded_error, ...) when the adapter parsed them, and a generic
// provider_error only when nothing better is known. The originating provider
// rides a response header either way, since the verbatim body cannot be
// tampered with to carry it.
func writeUpstreamError(w http.ResponseWriter, ue *domain.UpstreamError) {
	status := ue.StatusCode
	if status <= 0 {
		status = http.StatusBadGateway
	}
	// Forward the upstream's retry-signaling headers (Retry-After,
	// x-should-retry) so the client can honor the provider's backoff and
	// terminal-vs-retryable hint, not just the status code. Passthrough
	// lanes forward the upstream's headers wholesale, including its exact
	// Content-Type (e.g. Google's "application/json; charset=UTF-8"), so
	// only default the Content-Type when the upstream did not provide one.
	for k, v := range ue.Headers {
		w.Header().Set(k, v)
	}
	// A provider must not be able to make its body look LangWatch-authored.
	// herr.WriteHTTP sets this marker only for our handled envelopes.
	w.Header().Del(herr.HandledErrorHeader)
	if ue.Provider != "" {
		w.Header().Set("X-LangWatch-Provider", ue.Provider)
	}
	if w.Header().Get("Content-Type") == "" {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(status)
	if len(ue.Body) > 0 {
		_, _ = w.Write(ue.Body)
		return
	}
	errType := ue.ErrorType
	if errType == "" {
		errType = ue.ErrorCode
	}
	if errType == "" {
		errType = "provider_error"
	}
	errCode := ue.ErrorCode
	if errCode == "" {
		errCode = errType
	}
	meta := map[string]any{"status": status}
	if ue.Provider != "" {
		meta["provider"] = ue.Provider
	}
	body, _ := sonic.Marshal(map[string]any{
		"error": map[string]any{
			"type":    errType,
			"code":    errCode,
			"message": ue.Message,
			"meta":    meta,
		},
	})
	_, _ = w.Write(body)
}

// errorsRegisteredOnce guards a write into herr's package-level status map.
// Every NewRouter reaches it, and the test binary builds routers from parallel
// tests, so a plain bool here is a data race the race detector reports.
var errorsRegisteredOnce sync.Once

func registerErrorStatuses() {
	errorsRegisteredOnce.Do(registerErrorStatusesOnce)
}

func registerErrorStatusesOnce() {
	herr.RegisterStatus(domain.ErrInvalidAPIKey, http.StatusUnauthorized)
	herr.RegisterStatus(domain.ErrKeyRevoked, http.StatusForbidden)
	herr.RegisterStatus(domain.ErrKeyDisabled, http.StatusForbidden)
	herr.RegisterStatus(domain.ErrKeyExpired, http.StatusForbidden)
	herr.RegisterStatus(domain.ErrRateLimited, http.StatusTooManyRequests)
	herr.RegisterStatus(domain.ErrBudgetExceeded, http.StatusPaymentRequired)
	herr.RegisterStatus(domain.ErrGuardrailBlocked, http.StatusForbidden)
	herr.RegisterStatus(domain.ErrGuardrailUpstreamUnavailable, http.StatusServiceUnavailable)
	herr.RegisterStatus(domain.ErrPolicyViolation, http.StatusForbidden)
	herr.RegisterStatus(domain.ErrModelNotAllowed, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrProviderNotBound, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrModelNotRecognized, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrProviderError, http.StatusBadGateway)
	herr.RegisterStatus(domain.ErrProviderTimeout, http.StatusGatewayTimeout)
	// The three terminal provider-setup failures. 400, like their siblings
	// no_provider_configured and model_provider_not_bound: the request cannot
	// be served until something in the customer's model provider settings
	// changes, and a 5xx here is what made agent clients retry a dead
	// credential ten times before giving up.
	herr.RegisterStatus(domain.ErrProviderCredentialInvalid, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrProviderConfigInvalid, http.StatusBadRequest)
	// 401: the provider itself refused the credential, and forwarding its own
	// verdict is what error-transparency promises.
	herr.RegisterStatus(domain.ErrProviderCredentialRejected, http.StatusUnauthorized)
	// 502: the provider was never reached. Retryable, unlike the three above.
	herr.RegisterStatus(domain.ErrProviderConnectionFailed, http.StatusBadGateway)
	// 499 is nginx's "client closed request": the caller hung up before a
	// response was written. net/http has no constant for it because it is not
	// an IANA status — it exists to be LOGGED, which is exactly what makes it
	// right here. The alternatives both lie: 504 blames a provider that was
	// answering, and a 2xx credits a request nobody received. Written as a
	// literal because herrgen reads these registrations statically.
	herr.RegisterStatus(domain.ErrRequestAbandoned, 499)
	herr.RegisterStatus(domain.ErrBadRequest, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrMissingModel, http.StatusBadRequest)
	// Fail-closed attribution: the request is missing a required field
	// (the end-user id) while a per-end-user template is active. A
	// request-shape error like the two around it, so 400 per the house
	// table; unregistered it fell to 500 and read as a platform bug.
	herr.RegisterStatus(domain.ErrEndUserRequired, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrUnsupportedParameter, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrPayloadTooLarge, http.StatusRequestEntityTooLarge)
	herr.RegisterStatus(domain.ErrChainExhausted, http.StatusBadGateway)
	// 503, not 500: an open breaker is the gateway declining to hit an
	// upstream that has been failing, a retryable provider-side condition.
	// Unregistered it would default to 500 internal_error, which reads as a
	// gateway bug and hides that the provider is the thing to look at.
	herr.RegisterStatus(domain.ErrCircuitOpen, http.StatusServiceUnavailable)
	herr.RegisterStatus(domain.ErrNotFound, http.StatusNotFound)
	herr.RegisterStatus(domain.ErrInternal, http.StatusInternalServerError)
	herr.RegisterStatus(domain.ErrNoProviderConfigured, http.StatusBadRequest)
	herr.RegisterStatus(domain.ErrCodexSessionExpired, http.StatusUnauthorized)
	// Retryable by contract: the control plane failed us, not the caller.
	// A 5xx keeps client SDKs retrying instead of bubbling a config error.
	herr.RegisterStatus(domain.ErrAuthUpstream, http.StatusServiceUnavailable)
	// 429, like the rate limit above it: the key is at a cap that a call
	// ending will clear, so a client should back off and try again rather
	// than treat the refusal as terminal.
	herr.RegisterStatus(domain.ErrRealtimeSessionLimit, http.StatusTooManyRequests)
	// 503: the control plane could not record the session, which is our
	// fault and passes.
	herr.RegisterStatus(domain.ErrRealtimeRegistryUnavailable, http.StatusServiceUnavailable)
}
