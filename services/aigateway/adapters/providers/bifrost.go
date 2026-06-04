// Package providers wraps bifrost as the provider dispatch engine.
// All AI providers (OpenAI, Anthropic, Azure, Bedrock, Vertex, Gemini)
// are handled by a single bifrost instance. Per-request credentials
// come from context via the Account interface.
package providers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/bytedance/sonic"
	bifrost "github.com/maximhq/bifrost/core"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"go.uber.org/zap"

	"github.com/langwatch/langwatch/pkg/herr"
	"github.com/langwatch/langwatch/services/aigateway/domain"
)

// BifrostRouter dispatches requests through bifrost.
// Implements app.ProviderRouter.
type BifrostRouter struct {
	bf     *bifrost.Bifrost
	logger *zap.Logger
	// voyageClient is the single HTTP client reused for every direct
	// Voyage request so connection pooling actually works. Building a
	// new http.Client per request would defeat keep-alive and risk
	// port exhaustion under embedding throughput.
	voyageClient *http.Client
}

// BifrostOptions configures the bifrost router.
type BifrostOptions struct {
	Logger          *zap.Logger
	InitialPoolSize int
}

// NewBifrostRouter creates a provider router backed by bifrost.
func NewBifrostRouter(ctx context.Context, opts BifrostOptions) (*BifrostRouter, error) {
	pool := opts.InitialPoolSize
	if pool <= 0 {
		pool = 1000
	}
	bf, err := bifrost.Init(ctx, bfschemas.BifrostConfig{
		Account:         &account{},
		InitialPoolSize: pool,
		Logger:          &bifrostLogger{logger: opts.Logger},
	})
	if err != nil {
		return nil, fmt.Errorf("bifrost init: %w", err)
	}
	return &BifrostRouter{
		bf:           bf,
		logger:       opts.Logger,
		voyageClient: &http.Client{Timeout: 60 * time.Second},
	}, nil
}

// Close releases the underlying Bifrost connection pool. Safe to call
// once at process shutdown; subsequent dispatches after Close return
// undefined results from Bifrost.
func (r *BifrostRouter) Close() {
	if r == nil || r.bf == nil {
		return
	}
	r.bf.Shutdown()
}

// Dispatch sends a non-streaming request through bifrost.
//
// For /v1/chat/completions (RequestTypeChat) the inbound body is
// OpenAI-shape; we parse it into Bifrost's normalized
// (Input, Params) pair and Bifrost translates to the provider's native
// wire format (Anthropic Messages API, Gemini generateContent, etc.)
// + un-normalizes the response back to OpenAI shape.
//
// For /v1/messages (RequestTypeMessages) the inbound body is already
// provider-native (Anthropic /v1/messages shape). Running it through
// the OpenAI parser would silently drop Anthropic-specific fields like
// `thinking`, so we opt into Bifrost's raw-forward mode and let it
// passthrough. Downstream VKs for `/v1/messages` are expected to route
// to an Anthropic-family provider; sending it to OpenAI is a caller
// error and Bifrost/OpenAI will reject accordingly.
func (r *BifrostRouter) Dispatch(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error) {
	model := req.Model
	if req.Resolved != nil {
		model = req.Resolved.ModelID
	}

	// Voyage is not a Bifrost ModelProvider (its enum doesn't include
	// Voyage). The gateway proxies directly to api.voyageai.com — wire
	// format is OpenAI-compatible so no body translation is required.
	// Voyage ships embeddings only; any other request type lands on a
	// clean unsupported-type error.
	if cred.ProviderID == domain.ProviderVoyage {
		return r.dispatchVoyageDirect(ctx, req, model, cred)
	}

	provider := mapProvider(cred.ProviderID)

	if req.Type == domain.RequestTypeResponses {
		return r.dispatchResponses(ctx, req, provider, model, cred)
	}

	if req.Type == domain.RequestTypeEmbeddings {
		return r.dispatchEmbeddings(ctx, req, provider, model, cred)
	}

	if req.Type == domain.RequestTypePassthrough {
		return r.dispatchPassthrough(ctx, req, provider, model, cred)
	}

	// Managed-Bedrock with a per-request runtime endpoint (the customer's
	// VPC endpoint) dispatches through the official AWS SDK bedrockruntime
	// client with BaseEndpoint pinned to that VPCE, so the request is
	// SigV4-signed for and sent to that host instead of the public AWS
	// endpoint. Without this, the customer's VPCE-conditioned IAM policy
	// rejects the InvokeModel with a 403. Gated to RequestTypeChat only:
	// /v1/messages must stay on the raw-forward path below (routing
	// Anthropic-native bodies through Converse would drop messages-only
	// fields like `thinking`); embeddings/responses/passthrough are handled
	// above. A no-op for Bedrock credentials without a runtime endpoint.
	if req.Type == domain.RequestTypeChat {
		if endpoint, err := bedrockVPCEEndpoint(cred); err != nil {
			return nil, err
		} else if endpoint != "" {
			return r.dispatchBedrockVPCE(ctx, req, provider, model, cred, endpoint)
		}
	}

	bfReq, dispatchCtx, err := buildChatRequest(ctx, req, provider, model)
	if err != nil {
		return nil, err
	}

	bfCtx := bfschemas.NewBifrostContext(withCredential(dispatchCtx, cred), time.Time{})

	resp, berr := r.bf.ChatCompletionRequest(bfCtx, bfReq)
	if berr != nil {
		// Raw-forward paths (/v1/messages, OpenAI-compat chat) ask Bifrost
		// to retain the provider's native response bytes on the error —
		// prefer those over the generic 504 provider_timeout mask when
		// present. Clients like claude-code / OpenAI SDK need the real
		// provider error envelope (rate-limit hints, overload signals,
		// billing errors) to surface correctly.
		if rawBody, status, ok := rawResponseFromBifrostError(berr); ok {
			return &domain.Response{
				Body:       rawBody,
				StatusCode: status,
				Headers:    forwardableUpstreamHeaders(bifrostResponseHeaders(bfCtx)),
			}, nil
		}
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	// /v1/messages callers (Anthropic SDK, claude-code, ...) expect the
	// provider's native response shape — not Bifrost's OpenAI-normalized
	// BifrostChatResponse. When the raw-forward branch captured
	// ExtraFields.RawResponse (SendBackRawResponse=true in the context),
	// return those bytes verbatim instead of re-marshaling the normalized
	// struct. OpenAI-compat chat-completions callers keep the normalized
	// shape.
	if req.Type == domain.RequestTypeMessages {
		if rawBody, ok := rawResponseBytes(resp); ok {
			return &domain.Response{
				Body:       rawBody,
				StatusCode: http.StatusOK,
				Usage:      extractUsage(resp),
			}, nil
		}
	}

	body, _ := sonic.Marshal(resp)
	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractUsage(resp),
	}, nil
}

// dispatchResponses routes /v1/responses traffic through Bifrost's
// ResponsesRequest endpoint. The body is raw-forwarded — Bifrost's
// provider adapters (currently OpenAI + Azure) decode the native shape
// themselves. No need to normalize through the chat-completions parser.
func (r *BifrostRouter) dispatchResponses(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	bfReq := &bfschemas.BifrostResponsesRequest{
		Provider:       provider,
		Model:          model,
		RawRequestBody: req.Body,
		// Empty-slice (not nil) stub lets us bypass Bifrost's
		// makeResponsesRequest non-nil-Input guard at bifrost.go:778.
		// On the raw-forward path the provider adapter reads
		// req.RawRequestBody directly; Input is not consulted.
		Input: []bfschemas.ResponsesMessage{},
	}
	bfCtx := bfschemas.NewBifrostContext(rawForwardCtx(withCredential(ctx, cred)), time.Time{})

	resp, berr := r.bf.ResponsesRequest(bfCtx, bfReq)
	if berr != nil {
		if rawBody, status, ok := rawResponseFromBifrostError(berr); ok {
			return &domain.Response{
				Body:       rawBody,
				StatusCode: status,
				Headers:    forwardableUpstreamHeaders(bifrostResponseHeaders(bfCtx)),
			}, nil
		}
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	// Prefer the provider's native response bytes so /v1/responses
	// clients (codex, OpenAI Responses SDK, ...) see the exact wire
	// frames the provider emitted. Falls back to the normalized
	// BifrostResponsesResponse marshal if RawResponse is absent.
	if rawBody, ok := rawResponseBytesResp(resp); ok {
		return &domain.Response{
			Body:       rawBody,
			StatusCode: http.StatusOK,
			Usage:      extractResponsesUsage(resp),
		}, nil
	}

	body, _ := sonic.Marshal(resp)
	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractResponsesUsage(resp),
	}, nil
}

// dispatchEmbeddings routes /v1/embeddings traffic through Bifrost's
// EmbeddingRequest endpoint. The inbound body is OpenAI-shape
// ({"model": "...", "input": "..."}); we parse it into Bifrost's
// EmbeddingInput one-of (Text / Texts / Embedding / Embeddings) and
// Bifrost translates to the provider's native wire format for
// OpenAI / Gemini / Cohere etc.
//
// Anthropic ships no embeddings API; if a caller routes embeddings to
// an Anthropic credential we let Bifrost surface the provider's reject
// directly (no special-casing here keeps the error surface honest).
func (r *BifrostRouter) dispatchEmbeddings(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	bfReq, err := buildEmbeddingRequest(req, provider, model)
	if err != nil {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": err.Error()})
	}
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	resp, berr := r.bf.EmbeddingRequest(bfCtx, bfReq)
	if berr != nil {
		if rawBody, status, ok := rawResponseFromBifrostError(berr); ok {
			return &domain.Response{
				Body:       rawBody,
				StatusCode: status,
				Headers:    forwardableUpstreamHeaders(bifrostResponseHeaders(bfCtx)),
			}, nil
		}
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	body, _ := sonic.Marshal(resp)
	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractEmbeddingUsage(resp),
	}, nil
}

// dispatchVoyageDirect proxies an embedding request directly to
// api.voyageai.com. Voyage isn't in Bifrost's ModelProvider enum, so
// the gateway bypasses Bifrost for Voyage-credentialed traffic. The
// Voyage wire format is OpenAI-compatible (same `{"input": ..., "model": ...}`
// shape, same `{"data": [{"embedding": [...]}], "usage": {...}}`
// response), so the gateway forwards the body verbatim and surfaces
// the upstream response as-is.
//
// Non-embedding request types fail cleanly here. Voyage ships no
// chat/messages/responses APIs.
func (r *BifrostRouter) dispatchVoyageDirect(
	ctx context.Context,
	req *domain.Request,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	if req.Type != domain.RequestTypeEmbeddings {
		return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{
			"reason": fmt.Sprintf("voyage credentials only accept embedding requests; got %s", req.Type),
		})
	}

	// Voyage accepts the OpenAI shape verbatim. If the model id in the
	// resolved cred is provider-prefixed (`voyage/voyage-3.5`), strip
	// the prefix — Voyage's API just wants the bare model name.
	bodyBytes := req.Body
	if model != "" {
		stripped := strings.TrimPrefix(model, "voyage/")
		// Rewrite the model field on the JSON body to the bare name —
		// keeps the gateway in control of which model lands at the
		// provider regardless of what the caller put in the body.
		var err error
		bodyBytes, err = sjson.SetBytes(bodyBytes, "model", stripped)
		if err != nil {
			return nil, herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": fmt.Sprintf("rewrite model on body: %v", err)})
		}
	}

	httpReq, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		"https://api.voyageai.com/v1/embeddings",
		bytes.NewReader(bodyBytes),
	)
	if err != nil {
		return nil, fmt.Errorf("voyage direct request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+cred.APIKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := r.voyageClient.Do(httpReq)
	if err != nil {
		return nil, fmt.Errorf("voyage direct dispatch: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("voyage direct read body: %w", err)
	}

	// Pull usage off the response for the gateway's cost-accounting
	// pipeline. Voyage returns `usage: {total_tokens: N}` (no separate
	// prompt/completion split — embedding endpoints only consume
	// prompt tokens).
	usage := domain.Usage{}
	if resp.StatusCode == http.StatusOK {
		total := int(gjson.GetBytes(raw, "usage.total_tokens").Int())
		usage = domain.Usage{
			PromptTokens:     total,
			CompletionTokens: 0,
			TotalTokens:      total,
		}
	}

	return &domain.Response{
		Body:       raw,
		StatusCode: resp.StatusCode,
		Usage:      usage,
	}, nil
}

// DispatchStream sends a streaming request through bifrost. Routing
// semantics match Dispatch (translate on RequestTypeChat, raw-forward
// on RequestTypeMessages). Chunks returned by Bifrost are
// BifrostChatResponse (OpenAI-compatible), so the SSE bytes the gateway
// emits downstream are the shape the OpenAI SDK expects regardless of
// which provider Bifrost routed to.
func (r *BifrostRouter) DispatchStream(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error) {
	provider := mapProvider(cred.ProviderID)
	model := req.Model
	if req.Resolved != nil {
		model = req.Resolved.ModelID
	}

	if req.Type == domain.RequestTypeResponses {
		return r.dispatchResponsesStream(ctx, req, provider, model, cred)
	}

	if req.Type == domain.RequestTypePassthrough {
		return r.dispatchPassthroughStream(ctx, req, provider, model, cred)
	}

	// Managed-Bedrock with a per-request runtime endpoint streams through the
	// official Bedrock ConverseStream API over the customer's VPC endpoint —
	// same rationale as the non-streaming Dispatch intercept above, and gated
	// to RequestTypeChat for the same reason (/v1/messages stays raw-forward).
	// A no-op for Bedrock credentials without a runtime endpoint.
	if req.Type == domain.RequestTypeChat {
		if endpoint, err := bedrockVPCEEndpoint(cred); err != nil {
			return nil, err
		} else if endpoint != "" {
			return r.dispatchBedrockVPCEStream(ctx, req, provider, model, cred, endpoint)
		}
	}

	if req.Type == domain.RequestTypeChat && isOpenAICompatibleProvider(provider) {
		req.Body = ensureStreamIncludeUsage(req.Body)
	}

	bfReq, dispatchCtx, err := buildChatRequest(ctx, req, provider, model)
	if err != nil {
		return nil, err
	}

	bfCtx := bfschemas.NewBifrostContext(withCredential(dispatchCtx, cred), time.Time{})

	ch, berr := r.bf.ChatCompletionStreamRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	return &bifrostStreamIterator{ch: ch}, nil
}

// dispatchResponsesStream is the streaming sibling of dispatchResponses.
// Bifrost emits Responses-API-specific SSE event frames
// (response.created, response.output_item.added, response.output_text.delta,
// response.completed, ...); the gateway forwards each chunk's serialized
// BifrostResponsesResponse verbatim — clients using the OpenAI Responses
// SDK see the shape they expect.
func (r *BifrostRouter) dispatchResponsesStream(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (domain.StreamIterator, error) {
	bfReq := &bfschemas.BifrostResponsesRequest{
		Provider:       provider,
		Model:          model,
		RawRequestBody: req.Body,
		// Empty-slice (not nil) stub lets us bypass Bifrost's
		// makeResponsesRequest non-nil-Input guard at bifrost.go:778.
		// On the raw-forward path the provider adapter reads
		// req.RawRequestBody directly; Input is not consulted.
		Input: []bfschemas.ResponsesMessage{},
	}
	bfCtx := bfschemas.NewBifrostContext(rawForwardCtx(withCredential(ctx, cred)), time.Time{})

	ch, berr := r.bf.ResponsesStreamRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}
	return &bifrostStreamIterator{ch: ch}, nil
}

// dispatchPassthrough routes /v1beta/models/... (Gemini-native shape,
// consumed by gemini-cli and the @google/genai SDK) through Bifrost's
// Passthrough endpoint. The request body is forwarded verbatim; Bifrost
// only rewrites auth (x-goog-api-key) and base URL. Response is the raw
// upstream body with preserved status + headers, suitable for clients
// that expect Google's native generateContent response shape.
func (r *BifrostRouter) dispatchPassthrough(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (*domain.Response, error) {
	bfReq := passthroughRequest(req, model)
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	resp, berr := r.bf.Passthrough(bfCtx, provider, bfReq)
	if berr != nil {
		if rawBody, status, ok := rawResponseFromBifrostError(berr); ok {
			return &domain.Response{
				Body:       rawBody,
				StatusCode: status,
				Headers:    forwardableUpstreamHeaders(bifrostResponseHeaders(bfCtx)),
			}, nil
		}
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	status := resp.StatusCode
	if status == 0 {
		status = http.StatusOK
	}
	out := &domain.Response{
		Body:       resp.Body,
		StatusCode: status,
		Headers:    passthroughResponseHeaders(resp.Headers),
	}
	// Cost-enrichment downstream needs prompt/completion token counts on
	// the customer span. Bifrost's Passthrough adapter returns raw bytes
	// without a typed Usage struct, so extract Gemini's `usageMetadata`
	// here. Sibling logic in the stream iterator parses the same shape
	// per-chunk; this branch handles the synchronous :generateContent
	// (non-streaming) response.
	if u, ok := parseGeminiPassthroughUsage(resp.Body); ok {
		out.Usage = u
	}
	return out, nil
}

// dispatchPassthroughStream is the streaming sibling of dispatchPassthrough.
// Bifrost returns chunks whose Body is the raw SSE bytes emitted by the
// upstream (Google's streamGenerateContent already yields proper
// `event:/data:` framing); the iterator emits them unchanged so
// gemini-cli / @google/genai see the exact wire format they expect.
func (r *BifrostRouter) dispatchPassthroughStream(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (domain.StreamIterator, error) {
	bfReq := passthroughRequest(req, model)
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	ch, berr := r.bf.PassthroughStream(bfCtx, provider, bfReq)
	if berr != nil {
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}
	return &bifrostStreamIterator{ch: ch, rawFraming: true}, nil
}

// passthroughRequest builds the Bifrost-side passthrough request from
// our domain.Request. Body, method, path, query, and forwarded client
// headers are carried verbatim; model + provider drive key selection.
func passthroughRequest(req *domain.Request, model string) *bfschemas.BifrostPassthroughRequest {
	p := req.Passthrough
	return &bfschemas.BifrostPassthroughRequest{
		Model:       model,
		Method:      p.Method,
		Path:        p.Path,
		RawQuery:    p.RawQuery,
		Body:        req.Body,
		SafeHeaders: p.Headers,
	}
}

// passthroughResponseHeaders returns headers safe to forward to the
// client. Content-Length and Content-Encoding are dropped since the
// body we forward may differ in framing from what the upstream sent.
func passthroughResponseHeaders(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, len(in))
	for k, v := range in {
		switch {
		case strings.EqualFold(k, "Content-Length"),
			strings.EqualFold(k, "Content-Encoding"):
			continue
		default:
			out[k] = v
		}
	}
	return out
}

// rawForwardCtx enriches a context with both Bifrost flags the
// raw-forward code path needs: UseRawRequestBody sends the inbound
// bytes unchanged to the provider adapter; SendBackRawResponse attaches
// the provider's native response bytes to ExtraFields.RawResponse so
// the gateway can emit them verbatim downstream.
func rawForwardCtx(ctx context.Context) context.Context {
	ctx = context.WithValue(ctx, bfschemas.BifrostContextKeyUseRawRequestBody, true)
	ctx = context.WithValue(ctx, bfschemas.BifrostContextKeySendBackRawResponse, true)
	return ctx
}

// rawResponseBytes extracts the provider's native chat-completion
// response bytes from BifrostResponseExtraFields.RawResponse. Bifrost
// populates this only when BifrostContextKeySendBackRawResponse is set
// on the dispatch context (see rawForwardCtx). Returns (nil, false) if
// the response or raw payload is absent.
func rawResponseBytes(resp *bfschemas.BifrostChatResponse) ([]byte, bool) {
	if resp == nil {
		return nil, false
	}
	return extractRawResponseBytes(resp.ExtraFields.RawResponse)
}

// rawResponseBytesResp is the Responses-API sibling of rawResponseBytes.
func rawResponseBytesResp(resp *bfschemas.BifrostResponsesResponse) ([]byte, bool) {
	if resp == nil {
		return nil, false
	}
	return extractRawResponseBytes(resp.ExtraFields.RawResponse)
}

// extractRawResponseBytes normalises the various concrete types
// Bifrost may stash into ExtraFields.RawResponse (typed `interface{}`)
// into a []byte suitable for writing to the HTTP response.
//
// Bifrost's providers/utils EnrichError stores RawResponse as
// json.RawMessage (a distinct type from []byte in Go's type switch,
// so we must match it explicitly before the generic []byte branch).
func extractRawResponseBytes(raw interface{}) ([]byte, bool) {
	switch v := raw.(type) {
	case nil:
		return nil, false
	case json.RawMessage:
		if len(v) == 0 {
			return nil, false
		}
		return []byte(v), true
	case []byte:
		if len(v) == 0 {
			return nil, false
		}
		return v, true
	case string:
		if v == "" {
			return nil, false
		}
		return []byte(v), true
	default:
		b, err := sonic.Marshal(raw)
		if err != nil || len(b) == 0 {
			return nil, false
		}
		return b, true
	}
}

// rawResponseFromBifrostError peels the provider's native response bytes
// off a BifrostError — populated by Bifrost when the dispatch context
// carries BifrostContextKeySendBackRawResponse=true (raw-forward paths).
// Lets the gateway pass through Anthropic / OpenAI / etc. error
// envelopes verbatim instead of masking them as a generic 504
// provider_timeout, which is what clients like claude-code / codex
// expect to parse (rate-limit hints, overload signals, billing errors
// etc. ride in the provider-native error shape).
func rawResponseFromBifrostError(berr *bfschemas.BifrostError) ([]byte, int, bool) {
	if berr == nil {
		return nil, 0, false
	}
	body, ok := extractRawResponseBytes(berr.ExtraFields.RawResponse)
	if !ok {
		return nil, 0, false
	}
	status := http.StatusBadGateway
	if berr.StatusCode != nil && *berr.StatusCode > 0 {
		status = *berr.StatusCode
	}
	return body, status, true
}

// ListModels returns an empty list — model discovery is VK-config-driven.
func (r *BifrostRouter) ListModels(_ context.Context, _ []domain.Credential) ([]domain.Model, error) {
	return nil, nil
}

// --- Bifrost Account (multi-tenant credential provider) ---

type credCtxKey struct{}

func withCredential(ctx context.Context, cred domain.Credential) context.Context {
	return context.WithValue(ctx, credCtxKey{}, cred)
}

func credentialFromContext(ctx context.Context) domain.Credential {
	if v, ok := ctx.Value(credCtxKey{}).(domain.Credential); ok {
		return v
	}
	return domain.Credential{}
}

// account implements bfschemas.Account for multi-tenant credential dispatch.
type account struct{}

// providerLangwatchNoai is the Bifrost provider key for the local-dev
// `langwatch_noai` fake LLM. It's registered as a CustomProvider on top
// of Bifrost's OpenAI provider client, with its BaseURL pulled from
// `LANGWATCH_NOAI_BASE_URL`. In non-production the URL falls back to
// `http://localhost:5577`; in production the fallback is suppressed —
// operators have to opt in by setting LANGWATCH_NOAI_BASE_URL
// explicitly, so prod gateways don't carry it by accident.
const providerLangwatchNoai bfschemas.ModelProvider = "langwatch_noai"

// langwatchNoaiBaseURL returns the URL the fake LLM service listens on,
// falling back to the documented dev default. Returns "" when noai
// support should be disabled (handled by the caller).
func langwatchNoaiBaseURL() string {
	if v := os.Getenv("LANGWATCH_NOAI_BASE_URL"); v != "" {
		return v
	}
	// In production this env var is never set (the TS-side provider is
	// `devOnly`), so we only fall back in development-style processes
	// that haven't bothered to set it.
	if os.Getenv("ENVIRONMENT") == "production" {
		return ""
	}
	return "http://localhost:5577"
}

func (a *account) GetConfiguredProviders() ([]bfschemas.ModelProvider, error) {
	providers := append([]bfschemas.ModelProvider{}, bfschemas.StandardProviders...)
	if langwatchNoaiBaseURL() != "" {
		providers = append(providers, providerLangwatchNoai)
	}
	return providers, nil
}

func (a *account) GetKeysForProvider(ctx context.Context, provider bfschemas.ModelProvider) ([]bfschemas.Key, error) {
	if provider == providerLangwatchNoai {
		// Keyless. Bifrost still expects a Key with a non-empty ID; the
		// value is ignored by the noai server.
		return []bfschemas.Key{{ID: "langwatch-noai", Name: "langwatch-noai", Weight: 1}}, nil
	}
	cred := credentialFromContext(ctx)
	if cred.ID == "" {
		return nil, fmt.Errorf("no credential on context for provider %s", provider)
	}
	key := credentialToBifrostKey(cred, provider)
	return []bfschemas.Key{key}, nil
}

func (a *account) GetConfigForProvider(provider bfschemas.ModelProvider) (*bfschemas.ProviderConfig, error) {
	cfg := &bfschemas.ProviderConfig{}
	if proxyURL := os.Getenv("LW_GATEWAY_OUTBOUND_PROXY"); proxyURL != "" {
		// Debug-only: route outbound provider traffic through an HTTP proxy
		// (e.g. `http://localhost:8888` for mitmproxy). Lets operators
		// capture the exact request Bifrost sends to provider APIs —
		// unblocks outbound-delta diagnosis (headers, body) when a
		// provider-side behavior (e.g. Anthropic cache) fires on direct
		// curl but not through the gateway. Do NOT set in production.
		cfg.ProxyConfig = &bfschemas.ProxyConfig{
			Type: bfschemas.HTTPProxy,
			URL:  proxyURL,
		}
	}
	if provider == providerLangwatchNoai {
		base := langwatchNoaiBaseURL()
		if base == "" {
			return nil, fmt.Errorf("langwatch_noai provider not configured (LANGWATCH_NOAI_BASE_URL unset)")
		}
		cfg.NetworkConfig = bfschemas.NetworkConfig{BaseURL: base}
		cfg.CustomProviderConfig = &bfschemas.CustomProviderConfig{
			BaseProviderType: bfschemas.OpenAI,
			IsKeyLess:        true,
		}
	}
	cfg.CheckAndSetDefaults()
	return cfg, nil
}

// credentialToBifrostKey converts a domain.Credential into bifrost's Key format.
func credentialToBifrostKey(cred domain.Credential, provider bfschemas.ModelProvider) bfschemas.Key {
	k := bfschemas.Key{
		ID:     cred.ID,
		Name:   cred.ID,
		Weight: 1,
	}

	switch provider {
	case bfschemas.Azure:
		k.Value = envVar(cred.APIKey)
		endpoint := cred.Extra["endpoint"]
		cfg := &bfschemas.AzureKeyConfig{
			Endpoint:    envVar(endpoint),
			Deployments: cred.DeploymentMap,
		}
		if apiVersion, ok := cred.Extra["api_version"]; ok {
			v := envVar(apiVersion)
			cfg.APIVersion = &v
		}
		k.AzureKeyConfig = cfg

	case bfschemas.Bedrock:
		// Two nlpgo routes feed Bedrock creds under different key names: the
		// dispatcheradapter (Studio / workflows) translates to the canonical
		// access_key / secret_key / session_token / region, while the
		// gatewayproxy (/go/proxy) keeps the litellm aws_* names. Accept both
		// so neither route lands here with empty credentials.
		cfg := &bfschemas.BedrockKeyConfig{
			AccessKey:   envVar(credExtra(cred, "access_key", "aws_access_key_id")),
			SecretKey:   envVar(credExtra(cred, "secret_key", "aws_secret_access_key")),
			Deployments: cred.DeploymentMap,
		}
		if st := credExtra(cred, "session_token", "aws_session_token"); st != "" {
			v := envVar(st)
			cfg.SessionToken = &v
		}
		if region := credExtra(cred, "region", "aws_region_name"); region != "" {
			v := envVar(region)
			cfg.Region = &v
		}
		k.BedrockKeyConfig = cfg

	case bfschemas.Vertex:
		k.VertexKeyConfig = &bfschemas.VertexKeyConfig{
			ProjectID:       envVar(cred.Extra["project_id"]),
			ProjectNumber:   envVar(cred.Extra["project_number"]),
			Region:          envVar(cred.Extra["region"]),
			AuthCredentials: envVar(cred.Extra["auth_credentials"]),
		}

	default:
		// OpenAI, Anthropic, Gemini, etc. — plain API key.
		k.Value = envVar(cred.APIKey)
	}

	return k
}

func envVar(v string) bfschemas.EnvVar {
	return bfschemas.EnvVar{Val: v, FromEnv: false}
}

// --- Provider mapping ---

func mapProvider(id domain.ProviderID) bfschemas.ModelProvider {
	switch id {
	case domain.ProviderAzure:
		return bfschemas.Azure
	case domain.ProviderBedrock:
		return bfschemas.Bedrock
	case domain.ProviderVertex:
		return bfschemas.Vertex
	case domain.ProviderGemini:
		return bfschemas.Gemini
	case domain.ProviderAnthropic:
		return bfschemas.Anthropic
	default:
		return bfschemas.ModelProvider(string(id))
	}
}

// --- Error classification ---

// errFromBifrost turns a Bifrost dispatch error into the error the gateway
// surfaces to the client. When the provider returned a real HTTP status, that
// status (and the provider's native error body when Bifrost captured it) is
// forwarded verbatim via UpstreamError — so a terminal upstream 4xx reaches
// the client as that 4xx instead of a retryable 502, and the client can tell
// terminal from retryable correctly. A zero status means there was no upstream
// response (transport failure / timeout) — fall back to classification, which
// maps it to provider_timeout / the gateway's own error taxonomy.
//
// This is the streaming-path counterpart to the non-stream
// rawResponseFromBifrostError branch: streaming dispatch can only return an
// error, so the upstream status + body ride on UpstreamError instead of a
// *domain.Response.
func errFromBifrost(ctx context.Context, berr *bfschemas.BifrostError, respHeaders map[string]string) error {
	status := 0
	if berr.StatusCode != nil {
		status = *berr.StatusCode
	}
	if status <= 0 {
		return classifyBifrostError(ctx, berr)
	}
	body, _ := extractRawResponseBytes(berr.ExtraFields.RawResponse)
	return &domain.UpstreamError{
		StatusCode: status,
		Body:       body,
		Message:    bfErrorMsg(berr),
		Headers:    forwardableUpstreamHeaders(respHeaders),
	}
}

// bifrostResponseHeaders reads the provider's HTTP response headers that
// Bifrost stashes on the dispatch context (provider handlers call
// ctx.SetValue(BifrostContextKeyProviderResponseHeaders, ...) before returning,
// including on the non-2xx error path). Returns nil when absent.
func bifrostResponseHeaders(bfCtx *bfschemas.BifrostContext) map[string]string {
	if bfCtx == nil {
		return nil
	}
	if v, ok := bfCtx.Value(bfschemas.BifrostContextKeyProviderResponseHeaders).(map[string]string); ok {
		return v
	}
	return nil
}

// forwardableUpstreamHeaders selects the upstream response headers that are
// safe and useful to forward to the client on an error: the retry-signaling
// headers Retry-After (backoff hint on 429/503) and x-should-retry (the
// provider's canonical terminal-vs-retryable signal). Everything else
// (transport headers, content-length, auth echoes) is dropped. Match is
// case-insensitive; output uses canonical names.
func forwardableUpstreamHeaders(in map[string]string) map[string]string {
	if len(in) == 0 {
		return nil
	}
	out := make(map[string]string, 2)
	for k, v := range in {
		switch strings.ToLower(k) {
		case "retry-after":
			out["Retry-After"] = v
		case "x-should-retry":
			out["x-should-retry"] = v
		}
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

func classifyBifrostError(ctx context.Context, berr *bfschemas.BifrostError) error {
	status := 0
	if berr.StatusCode != nil {
		status = *berr.StatusCode
	}

	code := domain.ErrProviderError
	switch status {
	case http.StatusTooManyRequests:
		code = domain.ErrRateLimited
	case http.StatusGatewayTimeout, 0:
		code = domain.ErrProviderTimeout
	}

	return herr.New(ctx, code, herr.M{
		"status":  status,
		"message": bfErrorMsg(berr),
	})
}

func bfErrorMsg(e *bfschemas.BifrostError) string {
	if e == nil {
		return ""
	}
	if e.Error != nil {
		return e.Error.Message
	}
	return fmt.Sprintf("bifrost error (status %v)", e.StatusCode)
}

// --- Usage extraction ---

func extractUsage(resp *bfschemas.BifrostChatResponse) domain.Usage {
	if resp == nil || resp.Usage == nil {
		return domain.Usage{}
	}
	u := domain.Usage{
		PromptTokens:     resp.Usage.PromptTokens,
		CompletionTokens: resp.Usage.CompletionTokens,
		TotalTokens:      resp.Usage.TotalTokens,
	}
	if d := resp.Usage.PromptTokensDetails; d != nil {
		u.CacheReadTokens = d.CachedReadTokens
		u.CacheCreationTokens = d.CachedWriteTokens
	}
	return u
}

// extractResponsesUsage maps the Responses-API usage block onto the
// gateway's neutral domain.Usage. The Responses API uses
// input/output/total_tokens (not prompt/completion) — same numeric
// content, different names.
func extractResponsesUsage(resp *bfschemas.BifrostResponsesResponse) domain.Usage {
	if resp == nil || resp.Usage == nil {
		return domain.Usage{}
	}
	u := domain.Usage{
		PromptTokens:     resp.Usage.InputTokens,
		CompletionTokens: resp.Usage.OutputTokens,
		TotalTokens:      resp.Usage.TotalTokens,
	}
	if d := resp.Usage.InputTokensDetails; d != nil {
		u.CacheReadTokens = d.CachedReadTokens
		u.CacheCreationTokens = d.CachedWriteTokens
	}
	return u
}

// extractEmbeddingUsage maps Bifrost's embedding usage block. Embedding
// endpoints only consume input tokens (no output text), so
// CompletionTokens stays zero and the prompt total goes into both
// PromptTokens and TotalTokens to keep the cost math simple downstream.
func extractEmbeddingUsage(resp *bfschemas.BifrostEmbeddingResponse) domain.Usage {
	if resp == nil || resp.Usage == nil {
		return domain.Usage{}
	}
	return domain.Usage{
		PromptTokens:     resp.Usage.PromptTokens,
		CompletionTokens: 0,
		TotalTokens:      resp.Usage.TotalTokens,
	}
}

// --- Stream iterator ---

type bifrostStreamIterator struct {
	ch      chan *bfschemas.BifrostStreamChunk
	current []byte
	usage   domain.Usage
	err     error
	done    bool
	// rawFraming is set on passthrough streams where each chunk.Body is
	// already formatted SSE bytes from the upstream (Gemini streamGenerateContent
	// yields proper `event:/data:` framing). Router.writeSSE inspects this
	// to skip the default `data: <chunk>\n\n` re-wrap.
	rawFraming bool
}

func (it *bifrostStreamIterator) Next(ctx context.Context) bool {
	if it.done {
		return false
	}
	select {
	case <-ctx.Done():
		it.err = ctx.Err()
		it.done = true
		return false
	case chunk, ok := <-it.ch:
		if !ok {
			it.done = true
			return false
		}
		if chunk.BifrostError != nil {
			it.err = fmt.Errorf("stream error: %s", bfErrorMsg(chunk.BifrostError))
			it.done = true
			return false
		}
		if chunk.BifrostChatResponse != nil {
			data, _ := sonic.Marshal(chunk.BifrostChatResponse)
			it.current = data
			if chunk.BifrostChatResponse.Usage != nil {
				it.usage = extractUsage(chunk.BifrostChatResponse)
			}
		} else if chunk.BifrostResponsesStreamResponse != nil {
			// Responses API stream frames (response.created /
			// response.output_text.delta / response.completed / ...).
			// Marshal verbatim — clients using the OpenAI Responses SDK
			// decode these by `type`. Final usage appears on the
			// response.completed event's nested Response object.
			data, _ := sonic.Marshal(chunk.BifrostResponsesStreamResponse)
			it.current = data
			//nolint:staticcheck // explicit embedded-field reference matches the parallel branches above for readability.
			if resp := chunk.BifrostResponsesStreamResponse.Response; resp != nil && resp.Usage != nil {
				it.usage = extractResponsesUsage(resp)
			}
		} else if chunk.BifrostPassthroughResponse != nil {
			// Passthrough stream chunks carry the raw upstream bytes
			// (Gemini streamGenerateContent already emits proper
			// `event:/data:` SSE framing). Forward verbatim — the
			// writer side knows not to re-wrap when rawFraming is set.
			//nolint:staticcheck // explicit embedded-field reference matches the parallel branches above for readability.
			it.current = chunk.BifrostPassthroughResponse.Body
			// Parse Gemini-native usageMetadata out of the chunk body so
			// the trace wrapper can stamp prompt/completion/cached
			// tokens on the customer span. Bifrost's Passthrough adapter
			// doesn't emit a typed Usage struct on these chunks (raw
			// passthrough by design), so we crack the JSON here. Each
			// non-final chunk omits usageMetadata; we keep the last
			// non-zero values seen so the iterator's Usage() reports
			// the FINAL token totals at stream close.
			//nolint:staticcheck // explicit embedded-field reference matches the parallel branches above for readability.
			if u, ok := parseGeminiPassthroughUsage(chunk.BifrostPassthroughResponse.Body); ok {
				it.usage = u
			}
		}
		return true
	}
}

// parseGeminiPassthroughUsage extracts Gemini's `usageMetadata` block from a
// raw streamGenerateContent SSE chunk body. Lines have the form
//
//	data: {"candidates":[…],"usageMetadata":{…},"modelVersion":"…"}\n\n
//
// gjson tolerates the `data: ` prefix because we strip leading non-JSON
// bytes before searching. Returns (Usage{}, false) when the chunk doesn't
// carry usageMetadata (intermediate chunks); the iterator keeps its prior
// last-seen value so the FINAL chunk's totals win.
func parseGeminiPassthroughUsage(body []byte) (domain.Usage, bool) {
	if len(body) == 0 {
		return domain.Usage{}, false
	}
	// Strip leading `data: ` framing if present so gjson can parse the
	// embedded JSON object directly.
	scan := body
	if i := bytes.IndexByte(scan, '{'); i > 0 {
		scan = scan[i:]
	}
	usage := gjson.GetBytes(scan, "usageMetadata")
	if !usage.Exists() {
		return domain.Usage{}, false
	}
	prompt := int(usage.Get("promptTokenCount").Int())
	completion := int(usage.Get("candidatesTokenCount").Int())
	total := int(usage.Get("totalTokenCount").Int())
	if prompt == 0 && completion == 0 && total == 0 {
		return domain.Usage{}, false
	}
	if total == 0 {
		total = prompt + completion
	}
	// Gemini folds cachedContentTokenCount into promptTokenCount, so it rides
	// inside PromptTokens; surfacing it as CacheReadTokens lets the span report
	// the fresh input separately. Gemini bills no distinct cache-write tokens.
	return domain.Usage{
		PromptTokens:     prompt,
		CompletionTokens: completion,
		TotalTokens:      total,
		CacheReadTokens:  int(usage.Get("cachedContentTokenCount").Int()),
	}, true
}

func (it *bifrostStreamIterator) RawFraming() bool { return it.rawFraming }

func (it *bifrostStreamIterator) Chunk() []byte       { return it.current }
func (it *bifrostStreamIterator) Usage() domain.Usage { return it.usage }
func (it *bifrostStreamIterator) Err() error          { return it.err }
func (it *bifrostStreamIterator) Close() error        { return nil }

// --- Bifrost logger adapter ---

type bifrostLogger struct {
	logger *zap.Logger
}

func (l *bifrostLogger) Debug(msg string, args ...any)              { l.logger.Debug(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) Info(msg string, args ...any)               { l.logger.Info(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) Warn(msg string, args ...any)               { l.logger.Warn(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) Error(msg string, args ...any)              { l.logger.Error(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) Fatal(msg string, args ...any)              { l.logger.Fatal(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) SetLevel(_ bfschemas.LogLevel)              {}
func (l *bifrostLogger) SetOutputType(_ bfschemas.LoggerOutputType) {}
func (l *bifrostLogger) LogHTTPRequest(_ bfschemas.LogLevel, _ string) bfschemas.LogEventBuilder {
	return bfschemas.NoopLogEvent
}
