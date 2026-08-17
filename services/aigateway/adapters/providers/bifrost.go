// Package providers wraps bifrost as the provider dispatch engine.
// All AI providers (OpenAI, Anthropic, Azure, Bedrock, Vertex, Gemini)
// are handled by a single bifrost instance. Per-request credentials
// come from context via the Account interface.
package providers

import (
	"bytes"
	"container/list"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/tidwall/gjson"
	"github.com/tidwall/sjson"

	"github.com/bytedance/sonic"
	bifrost "github.com/maximhq/bifrost/core"
	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/trace"
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
	voyageClient   *http.Client
	endpointPolicy customerEndpointPolicy
	// anthropicCompat is the bounded registry of self-hosted Anthropic
	// endpoints behind derived provider keys; dispatch registers into it,
	// eviction tears down the bifrost provider behind the evicted key.
	anthropicCompat *anthropicCompatRegistry
	// discoveryOnce lazily builds the /v1/models discovery client and
	// cache. Lazy rather than constructor-built so a zero-value router
	// (used by tests and by any caller that only needs discovery) works
	// without a live Bifrost instance.
	discoveryOnce   sync.Once
	discoveryHTTP   *http.Client
	discoveryModels *modelsDiscoveryCache
	// hostedCatalogs overrides hostedModelCatalogs (tests only), pointing
	// hosted providers' catalog probes at local servers. nil means the
	// production table; an empty non-nil map disables hosted probes.
	hostedCatalogs map[domain.ProviderID]catalogProbe
	// codexClient streams against OpenAI's codex backend (no overall
	// timeout — turns run for minutes; cancellation rides the context).
	codexClient *http.Client
	// codexRefresher is the control-plane road for refreshing a 401'd
	// codex access token. Nil (e.g. in bare tests) degrades to reporting
	// the session as expired instead of retrying.
	codexRefresher  domain.CodexTokenRefresher
	codexBackendURL string
}

// BifrostOptions configures the bifrost router.
type BifrostOptions struct {
	Logger                        *zap.Logger
	InitialPoolSize               int
	BlockLocalHTTPCalls           bool
	RequireHTTPSCustomerEndpoints bool
	AllowedEndpointHosts          []string
	// CodexRefresher wires the control-plane token refresh for the codex
	// provider (see adapters/providers/codex.go).
	CodexRefresher domain.CodexTokenRefresher
	// CodexBackendURL overrides the codex upstream (tests only).
	CodexBackendURL string
	// OpenAIBackendURL overrides OpenAI's upstream (tests only). A credential
	// base_url reroutes to the vLLM chat-compat provider (see mapProvider);
	// this override instead keeps the request on bifrost's native OpenAI
	// provider, so tests can drive the real Responses stream pipeline against
	// a local server.
	OpenAIBackendURL string
}

// NewBifrostRouter creates a provider router backed by bifrost.
func NewBifrostRouter(ctx context.Context, opts BifrostOptions) (*BifrostRouter, error) {
	pool := opts.InitialPoolSize
	if pool <= 0 {
		pool = 1000
	}
	compatEndpoints := newAnthropicCompatRegistry(anthropicCompatMaxEndpoints)
	bf, err := bifrost.Init(ctx, bfschemas.BifrostConfig{
		Account: &account{
			anthropicCompat: compatEndpoints,
			openAIBaseURL:   opts.OpenAIBackendURL,
		},
		InitialPoolSize: pool,
		Logger:          &bifrostLogger{logger: opts.Logger},
	})
	if err != nil {
		return nil, fmt.Errorf("bifrost init: %w", err)
	}
	// Assigned after Init because the callback needs the bifrost instance;
	// safe because no dispatch (and therefore no eviction) can run before
	// NewBifrostRouter returns. Teardown runs on its own goroutine:
	// RemoveProvider waits for the evicted provider's in-flight requests
	// (up to the 14m request ceiling), which must not stall the dispatch
	// that triggered the eviction. RemoveProvider errors when the provider
	// was registered but never dispatched to (no pool exists) — nothing to
	// release, so only log it.
	compatEndpoints.onEvict = func(key bfschemas.ModelProvider) {
		go compatEndpoints.releaseEvicted(key, func(evictedKey bfschemas.ModelProvider) {
			if rmErr := bf.RemoveProvider(evictedKey); rmErr != nil {
				opts.Logger.Debug("anthropic-compat provider teardown skipped",
					zap.String("provider", string(evictedKey)), zap.Error(rmErr))
			}
		})
	}
	codexURL := opts.CodexBackendURL
	if codexURL == "" {
		codexURL = codexBackendDefaultURL
	}
	return &BifrostRouter{
		bf:           bf,
		logger:       opts.Logger,
		voyageClient: newVoyageClient(),
		endpointPolicy: newCustomerEndpointPolicy(
			opts.BlockLocalHTTPCalls,
			opts.RequireHTTPSCustomerEndpoints,
			opts.AllowedEndpointHosts,
		),
		anthropicCompat: compatEndpoints,
		codexClient:     newCodexClient(),
		codexRefresher:  opts.CodexRefresher,
		codexBackendURL: codexURL,
	}, nil
}

// newVoyageClient builds the direct Voyage HTTP client. Shares the
// gateway-wide request-timeout ceiling so no dispatch path keeps a shorter
// hidden limit.
func newVoyageClient() *http.Client {
	return &http.Client{Timeout: ProviderRequestTimeoutSeconds * time.Second}
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

func (r *BifrostRouter) validateCredentialEndpoints(ctx context.Context, cred domain.Credential) error {
	err := validateCredentialEndpoints(ctx, cred, r.endpointPolicy)
	if err != nil {
		code := domain.ErrBadRequest
		if isRetryableEndpointResolutionError(err) {
			code = domain.ErrProviderError
		}
		return herr.NewLight(ctx, code, herr.M{"reason": err.Error()})
	}
	return nil
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
// provider-native (Anthropic /v1/messages shape). Destinations that speak
// the Anthropic wire format keep Bifrost's raw-forward mode so the bytes
// pass through untouched; every other destination is translated through
// the neutral Responses request (see anthropic_translation.go), because
// forwarding an Anthropic body verbatim hands the provider JSON it
// cannot parse.
func (r *BifrostRouter) Dispatch(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error) {
	if err := r.validateCredentialEndpoints(ctx, cred); err != nil {
		return nil, err
	}
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

	// Codex streams upstream always (the backend is SSE-only); the
	// non-streaming path aggregates to the completed Response. See codex.go.
	// The backend speaks the Responses dialect only, so /v1/messages is
	// translated first (anthropic_codex.go): raw-forwarding an Anthropic body
	// would be rejected before it ever left the gateway.
	if cred.ProviderID == domain.ProviderOpenAICodex {
		if req.Type == domain.RequestTypeMessages {
			return r.dispatchMessagesTranslatedCodex(ctx, req, model, cred)
		}
		return r.dispatchCodex(ctx, req, model, cred)
	}

	provider := r.mapProviderForDispatch(cred)

	if req.Type == domain.RequestTypeResponses {
		return r.dispatchResponses(ctx, req, provider, model, cred)
	}

	if req.Type == domain.RequestTypeEmbeddings {
		return r.dispatchEmbeddings(ctx, req, provider, model, cred)
	}

	if req.Type == domain.RequestTypeSpeech {
		return r.dispatchSpeech(ctx, req, provider, model, cred)
	}

	if req.Type == domain.RequestTypeTranscription {
		return r.dispatchTranscription(ctx, req, provider, model, cred)
	}

	if req.Type == domain.RequestTypePassthrough {
		return r.dispatchPassthrough(ctx, req, provider, model, cred)
	}

	// /v1/messages to a destination that does not speak the Anthropic wire
	// format is translated rather than raw-forwarded. Forwarding verbatim
	// hands the provider a body it cannot parse and surfaces its own
	// "Unknown parameter: 'system'" back to the caller.
	if req.Type == domain.RequestTypeMessages && !isAnthropicWireProvider(provider) {
		return r.dispatchMessagesTranslated(ctx, req, provider, model, cred)
	}

	// Managed-Bedrock with a per-request runtime endpoint (the customer's
	// VPC endpoint) dispatches through the official AWS SDK bedrockruntime
	// client with BaseEndpoint pinned to that VPCE, so the request is
	// SigV4-signed for and sent to that host instead of the public AWS
	// endpoint. Without this, the customer's VPCE-conditioned IAM policy
	// rejects the InvokeModel with a 403. Gated to RequestTypeChat here:
	// /v1/messages took the translated lane above, which runs its own VPCE
	// intercept (anthropic_bedrock_vpce.go); embeddings/responses/passthrough
	// are handled above. A no-op for Bedrock credentials without a runtime
	// endpoint.
	if req.Type == domain.RequestTypeChat {
		if endpoint, err := bedrockVPCEEndpoint(cred); err != nil {
			return nil, err
		} else if endpoint != "" {
			return r.dispatchBedrockVPCE(ctx, req, provider, model, cred, endpoint)
		}
	}

	bfReq, dispatchCtx, err := buildChatRequest(ctx, req, provider, model)
	if err != nil {
		return nil, classifyChatBuildError(ctx, err)
	}
	stampParamsDropped(ctx, paramsDroppedFrom(dispatchCtx))

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
			usage := extractUsage(resp)
			// The normalized usage struct has one flat cache-write count, so
			// the write's lifetime is only in the provider's own body. Read it
			// back off the bytes we are about to return, then reconcile: this
			// lane mixes the normalized struct's write total with a split read
			// from the raw bytes, and on Anthropic-native responses the struct
			// reports no writes at all.
			usage.CacheCreation1hTokens = anthropicCacheCreation1h(rawBody)
			usage = usage.ReconcileCacheWrites()
			return &domain.Response{
				Body:       rawBody,
				StatusCode: http.StatusOK,
				Usage:      usage,
			}, nil
		}
	}

	body, _ := sonic.Marshal(resp)
	// Translated-lane response contract: a 200 must carry at least one
	// choice, and a policy drop must be visible on the envelope. Scoped to
	// the translated lanes: an OpenAI-compatible target can legitimately
	// answer 200 with an empty choices array when its safety system blocks
	// the output, and rewriting that into finish_reason "length" would
	// report a truncation that never happened.
	if _, translated := policyLaneFor(provider); translated {
		body = ensureChoicesPresent(body)
	}
	body = injectParamsDropped(body, paramsDroppedFrom(dispatchCtx))
	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractUsage(resp),
	}, nil
}

// ensureChoicesPresent repairs a 200 whose choices came back null or
// empty. The gemini translator skips candidates whose content has no
// parts (providers/gemini/chat.go, the thinking-exhausted-cap case), so
// a model that spent the whole completion budget on thinking produced an
// HTTP 200 with "choices": null, usage billed, and no signal anywhere: an
// empty success that also breaks strict OpenAI parsers. Synthesizing a
// finish_reason "length" choice with empty content makes the outcome what
// an OpenAI client understands: the cap truncated the answer.
func ensureChoicesPresent(body []byte) []byte {
	choices := gjson.GetBytes(body, "choices")
	if choices.IsArray() && len(choices.Array()) > 0 {
		return body
	}
	out, err := sjson.SetBytes(body, "choices", []map[string]any{{
		"index": 0,
		"message": map[string]any{
			"role":    "assistant",
			"content": "",
		},
		"finish_reason": "length",
	}})
	if err != nil {
		return body
	}
	return out
}

// injectParamsDropped records the parameter-policy drop list on the
// response envelope (extra_fields.params_dropped), alongside the
// X-LangWatch-Params-Dropped header and the span attribute, so a dropped
// parameter is observable from the response body alone.
func injectParamsDropped(body []byte, dropped []string) []byte {
	if len(dropped) == 0 {
		return body
	}
	out, err := sjson.SetBytes(body, "extra_fields.params_dropped", dropped)
	if err != nil {
		return body
	}
	return out
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
// semantics match Dispatch:
//
//   - RequestTypeChat: translate inbound OpenAI-shape body through Bifrost's
//     ChatCompletionStream, emit BifrostChatResponse (OpenAI-compatible)
//     chunks. OpenAI SDK clients decode these as `delta.choices`.
//   - RequestTypeMessages: raw-forward through Bifrost's PassthroughStream
//     so the provider's native SSE frames (`event: content_block_delta`,
//     `event: message_start`, etc.) reach the client unchanged. Anthropic
//     SDK clients (Vercel AI SDK anthropic, opencode) Zod-validate every
//     chunk against the Messages event union and reject any OpenAI-shape
//     `delta.choices` payload with `No matching discriminator on 'type'`.
//   - RequestTypeResponses: dedicated dispatchResponsesStream that emits
//     OpenAI Responses-API SSE frames verbatim.
//   - RequestTypePassthrough: dedicated dispatchPassthroughStream (Gemini
//     /v1beta/...:streamGenerateContent).
func (r *BifrostRouter) DispatchStream(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error) {
	if err := r.validateCredentialEndpoints(ctx, cred); err != nil {
		return nil, err
	}
	model := req.Model
	if req.Resolved != nil {
		model = req.Resolved.ModelID
	}

	// Codex bypasses Bifrost entirely: a direct SSE proxy to OpenAI's codex
	// backend with OAuth + one-shot token refresh. See codex.go. Its backend
	// speaks the Responses dialect only, so /v1/messages goes through the
	// translated codex lane (anthropic_codex.go) and comes back as the
	// Anthropic SSE union.
	if cred.ProviderID == domain.ProviderOpenAICodex {
		if req.Type == domain.RequestTypeMessages {
			return r.dispatchMessagesTranslatedCodexStream(ctx, req, model, cred)
		}
		return r.dispatchCodexStream(ctx, req, model, cred)
	}

	provider := r.mapProviderForDispatch(cred)

	if req.Type == domain.RequestTypeResponses {
		return r.dispatchResponsesStream(ctx, req, provider, model, cred)
	}

	if req.Type == domain.RequestTypePassthrough {
		return r.dispatchPassthroughStream(ctx, req, provider, model, cred)
	}

	if req.Type == domain.RequestTypeMessages {
		// Anthropic-wire destinations keep the raw-forward passthrough so the
		// provider's own SSE frames reach the client untouched. Everything
		// else is translated: PassthroughStream would POST /v1/messages to a
		// provider that has no such route, and the iterator would then block
		// on a channel yielding neither chunk nor error.
		if isAnthropicWireProvider(provider) {
			return r.dispatchMessagesStream(ctx, req, provider, model, cred)
		}
		return r.dispatchMessagesTranslatedStream(ctx, req, provider, model, cred)
	}

	// Managed-Bedrock with a per-request runtime endpoint streams through the
	// official Bedrock ConverseStream API over the customer's VPC endpoint —
	// same rationale as the non-streaming Dispatch intercept above. Gated to
	// RequestTypeChat because /v1/messages took its own lanes above, each
	// with its own VPCE handling. A no-op for Bedrock credentials without a
	// runtime endpoint.
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
		return nil, classifyChatBuildError(ctx, err)
	}
	dropped := paramsDroppedFrom(dispatchCtx)
	stampParamsDropped(ctx, dropped)

	bfCtx := bfschemas.NewBifrostContext(withCredential(dispatchCtx, cred), time.Time{})

	ch, berr := r.bf.ChatCompletionStreamRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}

	return &bifrostStreamIterator{ch: ch, paramsDropped: dropped}, nil
}

// classifyChatBuildError turns a buildChatRequest failure into the right
// client-facing 400: parameter-policy refusals carry the policy's full
// sentence under unsupported_parameter (the code OpenAI itself uses for
// parameter rejections), everything else is a malformed client body.
func classifyChatBuildError(ctx context.Context, err error) error {
	var refusal *paramRefusalError
	if errors.As(err, &refusal) {
		return herr.New(ctx, domain.ErrUnsupportedParameter, herr.M{"message": refusal.msg, "fault": "customer"})
	}
	// Everything else buildChatRequest can reject is a client-body problem
	// (unparseable JSON, malformed params): classify it as a 400 the same
	// way the embeddings lane does, not an internal error.
	return herr.New(ctx, domain.ErrBadRequest, herr.M{"reason": err.Error()})
}

// stampParamsDropped records the policy drop list on the gateway's
// request span so drops are visible on the trace, not only on the
// response envelope. Parameter names are shape metadata, never content.
func stampParamsDropped(ctx context.Context, dropped []string) {
	if len(dropped) == 0 {
		return
	}
	trace.SpanFromContext(ctx).SetAttributes(
		attribute.StringSlice("langwatch.gateway.params_dropped", dropped))
}

// dispatchMessagesStream raw-forwards a streaming /v1/messages request
// through Bifrost's PassthroughStream so the upstream provider's native
// SSE frames (Anthropic's `event: message_start / content_block_start /
// content_block_delta / message_delta / message_stop`) reach the client
// unchanged. Bifrost's ChatCompletionStream would emit OpenAI-shape
// `delta.choices` chunks instead, which Anthropic SDK clients (Vercel
// AI SDK, opencode) Zod-validate and reject with `No matching
// discriminator on 'type'`.
//
// The non-streaming /v1/messages path achieves the same effect through
// SendBackRawResponse + rawResponseBytes(); Bifrost's stream chunks
// don't expose a comparable raw-bytes hook on each frame, so the fix
// is to route through PassthroughStream instead. The provider's
// PassthroughStream impl (anthropic.go:2700) sets x-api-key +
// anthropic-version and forwards Method/Path/Body/Headers verbatim,
// then streams the raw fasthttp body back chunk-by-chunk — exactly
// what gemini's /v1beta passthrough already does for its native shape.
func (r *BifrostRouter) dispatchMessagesStream(
	ctx context.Context,
	req *domain.Request,
	provider bfschemas.ModelProvider,
	model string,
	cred domain.Credential,
) (domain.StreamIterator, error) {
	bfReq := &bfschemas.BifrostPassthroughRequest{
		Model:  model,
		Method: "POST",
		Path:   "/v1/messages",
		Body:   req.Body,
		SafeHeaders: map[string]string{
			"content-type": "application/json",
			"accept":       "text/event-stream",
		},
	}
	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	ch, berr := r.bf.PassthroughStream(bfCtx, provider, bfReq)
	if berr != nil {
		return nil, errFromBifrost(ctx, berr, bifrostResponseHeaders(bfCtx))
	}
	return &bifrostStreamIterator{
		ch:         ch,
		rawFraming: true,
		parseUsage: parseAnthropicPassthroughUsage,
	}, nil
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
			strings.EqualFold(k, "Content-Encoding"),
			// A provider must not be able to echo this header and have it
			// forwarded as if the gateway had authored the response.
			strings.EqualFold(k, herr.HandledErrorHeader):
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

// paramsDroppedCtxKey carries the parameter-policy drop list from the
// parse layer to the response path, so the drop can be signaled on the
// response envelope, header, and span.
type paramsDroppedCtxKey struct{}

func withParamsDropped(ctx context.Context, dropped []string) context.Context {
	if len(dropped) == 0 {
		return ctx
	}
	return context.WithValue(ctx, paramsDroppedCtxKey{}, dropped)
}

// paramsDroppedFrom returns the drop list recorded by the parameter
// policy, nil when nothing was dropped.
func paramsDroppedFrom(ctx context.Context) []string {
	dropped, _ := ctx.Value(paramsDroppedCtxKey{}).([]string)
	return dropped
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
type account struct {
	// anthropicCompat resolves derived anthropic-compat provider keys to
	// their endpoints. Shared with the router, which registers endpoints
	// at dispatch time.
	anthropicCompat *anthropicCompatRegistry
	// openAIBaseURL redirects bifrost's native OpenAI provider to a local
	// server in tests. Empty in production. See BifrostOptions.OpenAIBackendURL.
	openAIBaseURL string
}

func (a *account) GetConfiguredProviders() ([]bfschemas.ModelProvider, error) {
	return bfschemas.StandardProviders, nil
}

func (a *account) GetKeysForProvider(ctx context.Context, provider bfschemas.ModelProvider) ([]bfschemas.Key, error) {
	cred := credentialFromContext(ctx)
	if cred.ID == "" {
		return nil, fmt.Errorf("no credential on context for provider %s", provider)
	}
	key := credentialToBifrostKey(cred, provider)
	return []bfschemas.Key{key}, nil
}

// ProviderRequestTimeoutSeconds is the gateway-wide upstream request timeout,
// applied to every provider. Bifrost's built-in default is 30s, which long
// LLM completions (reasoning models, large generations) regularly exceed —
// in prod that surfaced as `upstream error (status 504): request timed out
// (default is 30 seconds)` on evaluator LLM calls. The gateway's
// longest-running callers are AWS Lambdas hard-capped at 15 minutes, so 14
// minutes is the useful ceiling: long enough for any realistic completion,
// one minute of margin under the caller's cap.
const ProviderRequestTimeoutSeconds = 14 * 60

func (a *account) GetConfigForProvider(provider bfschemas.ModelProvider) (*bfschemas.ProviderConfig, error) {
	cfg := &bfschemas.ProviderConfig{}
	// Every provider is sized explicitly, standard ones included. A zero here
	// is not "no opinion": CheckAndSetDefaults at the bottom of this function
	// replaces it with bifrost's own 1000 workers and 5000-slot queue, and
	// GetConfiguredProviders registers the whole standard list up front, so
	// leaving it zero bought a worker pool per provider whether or not this
	// install ever dispatches to it. See standardProviderConcurrency.
	cfg.ConcurrencyAndBufferSize = bfschemas.ConcurrencyAndBufferSize{
		Concurrency: standardProviderConcurrency,
		BufferSize:  standardProviderBufferSize,
	}
	if strings.HasPrefix(string(provider), anthropicCompatPrefix) ||
		strings.HasPrefix(string(provider), geminiCompatPrefix) {
		endpoint, ok := a.anthropicCompat.lookup(string(provider))
		if !ok {
			return nil, fmt.Errorf("no endpoint registered for URL-derived provider %q", provider)
		}
		cfg.NetworkConfig.BaseURL = endpoint.baseURL
		cfg.CustomProviderConfig = &bfschemas.CustomProviderConfig{
			BaseProviderType: endpoint.baseType,
			IsKeyLess:        endpoint.keyless,
		}
		// Every compat endpoint gets its own bifrost worker pool, unlike the
		// OpenAI-compat path where all customer endpoints share the single
		// VLLM provider. Bifrost's defaults (1000 workers, 5000-slot queue)
		// are sized for a hosted provider fronting the whole gateway; taking
		// them per endpoint would let customer configuration multiply the
		// process's goroutine count several times over. A self-hosted server
		// saturates far below this, and a burst past the queue applies
		// backpressure rather than failing: bifrost only drops queued
		// requests under DropExcessRequests, which the gateway leaves off.
		cfg.ConcurrencyAndBufferSize = bfschemas.ConcurrencyAndBufferSize{
			Concurrency: anthropicCompatConcurrency,
			BufferSize:  anthropicCompatBufferSize,
		}
	}
	// Whole-gateway timeout ceiling. StreamIdleTimeoutInSeconds gets the
	// same value: its 60s default is a per-chunk gap limit, and reasoning
	// models can think for minutes before the first token without emitting
	// anything.
	cfg.NetworkConfig.DefaultRequestTimeoutInSeconds = ProviderRequestTimeoutSeconds
	cfg.NetworkConfig.StreamIdleTimeoutInSeconds = ProviderRequestTimeoutSeconds
	if provider == bfschemas.OpenAI && a.openAIBaseURL != "" {
		cfg.NetworkConfig.BaseURL = a.openAIBaseURL
	}
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
		// Accept both endpoint names: the control-plane/VK path
		// (config.materialiser.ts / config_wire.go) sends "endpoint", but the
		// /go/proxy path (gatewayproxy.ParseCredentialFromHeaders) carries the
		// customer's Azure endpoint under the litellm-era "api_base" name. Reading
		// only "endpoint" left every Azure scenario/playground call dispatching
		// with an empty endpoint → Bifrost "endpoint not set" (#5760). Mirrors the
		// dual-name tolerance credBaseURL already applies to vLLM.
		endpoint := credExtra(cred, "endpoint", "api_base")
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

	case bfschemas.VLLM:
		// OpenAI-compatible endpoint hosted by the customer (vLLM,
		// LiteLLM proxy, ...). The base URL rides on the key — Bifrost's
		// vLLM provider has no provider-level URL fallback. The API key
		// may legitimately be empty (unauthenticated self-hosted server).
		k.Value = envVar(cred.APIKey)
		url := credBaseURL(cred)
		if url == "" && cred.ProviderID == domain.ProviderDeepSeek {
			// DeepSeek rides the openai-compat path (no Bifrost-native
			// provider) but is a hosted API, not a customer endpoint —
			// customers configure only an API key, so default the URL.
			url = deepseekBaseURL
		}
		k.VLLMKeyConfig = &bfschemas.VLLMKeyConfig{
			URL: envVar(normalizeOpenAICompatBaseURL(url)),
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

// mapProviderForDispatch maps the credential to its bifrost provider key
// and, for Anthropic credentials with a base-URL override, records the
// endpoint in the bounded registry so GetConfigForProvider can resolve it —
// refreshing LRU recency on every dispatch so actively used endpoints are
// never the ones evicted.
func (r *BifrostRouter) mapProviderForDispatch(cred domain.Credential) bfschemas.ModelProvider {
	provider := mapProvider(cred)
	if strings.HasPrefix(string(provider), anthropicCompatPrefix) ||
		strings.HasPrefix(string(provider), geminiCompatPrefix) {
		return r.anthropicCompat.register(cred)
	}
	return provider
}

func mapProvider(cred domain.Credential) bfschemas.ModelProvider {
	switch cred.ProviderID {
	case domain.ProviderAzure:
		return bfschemas.Azure
	case domain.ProviderBedrock:
		return bfschemas.Bedrock
	case domain.ProviderVertex:
		return bfschemas.Vertex
	case domain.ProviderGemini:
		// A credential carrying a project and region is an Agent Platform
		// key — Gemini's second door. It dispatches through a derived
		// custom provider (base type Gemini) whose base URL names the
		// project and location, because the stock Gemini provider is
		// pinned to generativelanguage.googleapis.com, where such a key
		// is refused by its own restrictions.
		if credentialIsAgentPlatform(cred) {
			return geminiCompatProviderKey(cred)
		}
		return bfschemas.Gemini
	case domain.ProviderAnthropic:
		// Anthropic with a base-URL override (self-hosted server speaking
		// the Anthropic Messages API natively — vLLM >= 0.24, Claude-
		// compatible proxies) must not hit api.anthropic.com. Bifrost's
		// Anthropic key has no per-key URL slot, so derive a per-endpoint
		// custom provider (base type Anthropic) whose config carries the
		// URL; bifrost creates it lazily on first dispatch.
		if credBaseURL(cred) != "" {
			return anthropicCompatProviderKey(cred)
		}
		return bfschemas.Anthropic
	case domain.ProviderDeepSeek:
		// DeepSeek is not in Bifrost's ModelProvider enum; its API is
		// OpenAI-compatible, so route it through the vLLM adapter. The
		// base URL defaults to DeepSeek's public endpoint in
		// credentialToBifrostKey.
		return bfschemas.VLLM
	case domain.ProviderCustom:
		// Customer-hosted OpenAI-compatible endpoint. Bifrost's vLLM
		// provider is its generic OpenAI-compat adapter with a per-key
		// base URL — exactly the shape a custom provider needs.
		return bfschemas.VLLM
	case domain.ProviderOpenAI:
		// OpenAI with a base-URL override (self-hosted vLLM / LiteLLM
		// arriving via the custom→openai translation in the nlpgo proxy
		// path) must not hit api.openai.com. Bifrost's OpenAI key has no
		// per-key URL slot, so route through the vLLM provider, which
		// speaks the same wire format and carries the URL on the key.
		if credBaseURL(cred) != "" {
			return bfschemas.VLLM
		}
		return bfschemas.OpenAI
	default:
		// Bifrost-native providers whose enum value matches our
		// ProviderID string verbatim (xai, groq, cerebras, ...).
		return bfschemas.ModelProvider(string(cred.ProviderID))
	}
}

// deepseekBaseURL is DeepSeek's public OpenAI-compatible endpoint, used
// when a DeepSeek credential arrives without an explicit base URL.
const deepseekBaseURL = "https://api.deepseek.com"

// credBaseURL returns the customer-configured endpoint override for
// OpenAI-compatible credentials. The control-plane wire names it
// "base_url" (config.materialiser.ts), the litellm-era nlpgo paths name
// it "api_base" — accept both.
func credBaseURL(cred domain.Credential) string {
	return credExtra(cred, "base_url", "api_base")
}

// anthropicCompatPrefix namespaces the provider keys derived for Anthropic
// credentials with a base-URL override. The prefix keeps the keys out of
// Bifrost's ModelProvider enum, so each endpoint gets its own lazily-created
// provider instance (base type Anthropic) instead of mutating the shared
// stock Anthropic provider.
const anthropicCompatPrefix = "anthropic-url-"

type anthropicCompatEndpoint struct {
	baseURL string
	// keyless marks credentials without an API key (unauthenticated
	// self-hosted servers). Bifrost's key selection filters out
	// empty-value keys for base provider Anthropic and fails the
	// dispatch; CustomProviderConfig.IsKeyLess skips selection entirely.
	keyless bool
	// baseType is the bifrost provider whose wire format the endpoint
	// speaks: Anthropic for self-hosted Anthropic-compatible servers,
	// Gemini for the Agent Platform door (a Gemini credential carrying a
	// project and location — see geminiAgentPlatformEndpointForCred). The
	// registry that holds these entries is shared by both; only the
	// derivation and the prefix differ.
	baseType bfschemas.ModelProvider
}

// anthropicCompatMaxEndpoints bounds the endpoint registry. Every distinct
// endpoint behind a derived provider key costs a bifrost worker pool, so the
// bound is what keeps endpoint rotation across tenants from leaking pools for
// the life of the process. Sized well above the number of self-hosted
// Anthropic endpoints a single gateway process realistically serves
// concurrently; an endpoint that rotates out is torn down and transparently
// re-created on its next dispatch.
const anthropicCompatMaxEndpoints = 32

// anthropicCompatConcurrency and anthropicCompatBufferSize size the worker
// pool bifrost creates per compat endpoint. Together with the endpoint bound
// they cap what customer configuration can cost the process: 32 endpoints of
// 128 workers instead of the 32k goroutines bifrost's own per-provider
// defaults would produce.
const (
	anthropicCompatConcurrency = 128
	anthropicCompatBufferSize  = 1024
)

// standardProviderConcurrency and standardProviderBufferSize size the worker
// pool bifrost creates for each entry in bfschemas.StandardProviders.
//
// GetConfiguredProviders returns that whole list, because a virtual key may
// name any provider and bifrost resolves config by provider key alone. Left
// unset, each of the 23 entries took bifrost's own defaults — 1000 workers
// and a 5000-slot queue, sized for a deployment where one provider fronts the
// entire gateway. Paid 23 times over, that was ~21,000 permanently parked
// goroutines per pod in production (99.85% of the process's goroutines), for
// providers most installs never dispatch to. Their only measurable effect was
// making the GC rescan 21,000 stacks on every mark cycle and the profiler
// serialize them every 15 seconds.
//
// 128 is the figure the compat path above already arrived at, for the same
// reason: the pool bounds in-flight upstream requests, and a burst past it
// queues rather than fails — bifrost drops queued requests only under
// DropExcessRequests, which the gateway leaves off. Across the production
// pods that is several hundred concurrent upstream requests per provider,
// far above what the gateway's own request ceiling makes reachable.
const (
	standardProviderConcurrency = 128
	standardProviderBufferSize  = 1024
)

// anthropicCompatRegistry maps derived provider keys to their endpoints.
// Bifrost resolves provider config by provider key alone — GetConfigForProvider
// has no credential context — so dispatch records the endpoint here before
// enqueueing, and config resolution looks it up.
//
// The registry is LRU-bounded: every dispatch refreshes its endpoint's
// recency, and inserting beyond capacity evicts the least-recently-dispatched
// endpoint, firing onEvict so the router can release the bifrost provider
// (worker pool + queue) behind the evicted key. Without eviction, every base
// URL ever dispatched to — including endpoints rotated away in the control
// plane — would retain a live worker pool forever.
type anthropicCompatRegistry struct {
	mu      sync.Mutex
	cap     int
	entries map[string]*list.Element
	order   *list.List // front = most recently dispatched
	// onEvict releases the bifrost provider behind an evicted key. Assigned
	// once in NewBifrostRouter before any dispatch can run; called outside
	// the registry lock.
	onEvict func(key bfschemas.ModelProvider)
}

type anthropicCompatEntry struct {
	key      string
	endpoint anthropicCompatEndpoint
}

func newAnthropicCompatRegistry(capacity int) *anthropicCompatRegistry {
	return &anthropicCompatRegistry{
		cap:     capacity,
		entries: make(map[string]*list.Element),
		order:   list.New(),
	}
}

// register records the credential's endpoint under its derived provider key,
// refreshes LRU recency, and returns the key. Evicts beyond capacity.
func (reg *anthropicCompatRegistry) register(cred domain.Credential) bfschemas.ModelProvider {
	endpoint, key := compatEndpointForCred(cred)

	reg.mu.Lock()
	if el, ok := reg.entries[string(key)]; ok {
		reg.order.MoveToFront(el)
		reg.mu.Unlock()
		return key
	}
	reg.entries[string(key)] = reg.order.PushFront(anthropicCompatEntry{
		key:      string(key),
		endpoint: endpoint,
	})
	var evicted []string
	for len(reg.entries) > reg.cap {
		back := reg.order.Back()
		entry := back.Value.(anthropicCompatEntry)
		reg.order.Remove(back)
		delete(reg.entries, entry.key)
		evicted = append(evicted, entry.key)
	}
	onEvict := reg.onEvict
	reg.mu.Unlock()

	if onEvict != nil {
		for _, k := range evicted {
			onEvict(bfschemas.ModelProvider(k))
		}
	}
	return key
}

// releaseEvicted runs release for an evicted key, unless a dispatch put the
// same endpoint back in the live set between the eviction and this call.
// Releasing then would close the bifrost queue that dispatch is about to
// enqueue on, and bifrost answers those requests with "provider is shutting
// down" instead of routing them; leaving the provider alone costs nothing
// because the next eviction of that key schedules the teardown again.
func (reg *anthropicCompatRegistry) releaseEvicted(key bfschemas.ModelProvider, release func(bfschemas.ModelProvider)) {
	if _, live := reg.lookup(string(key)); live {
		return
	}
	release(key)
}

// lookup resolves a derived provider key to its endpoint. Nil-safe so an
// account without a registry (bare unit-test construction) degrades to
// "not registered" instead of panicking.
func (reg *anthropicCompatRegistry) lookup(key string) (anthropicCompatEndpoint, bool) {
	if reg == nil {
		return anthropicCompatEndpoint{}, false
	}
	reg.mu.Lock()
	defer reg.mu.Unlock()
	el, ok := reg.entries[key]
	if !ok {
		return anthropicCompatEndpoint{}, false
	}
	return el.Value.(anthropicCompatEntry).endpoint, true
}

// anthropicCompatEndpointForCred derives the endpoint identity and provider
// key for an Anthropic credential with a base-URL override. The key is a
// hash of the endpoint identity (URL + keyless-ness), so the same endpoint
// always lands on the same bifrost worker pool, distinct endpoints never
// collide, and rotating the API key value alone does not spawn a new
// provider. Pure derivation — registration happens at dispatch time via
// anthropicCompatRegistry.register.
func anthropicCompatEndpointForCred(cred domain.Credential) (anthropicCompatEndpoint, bfschemas.ModelProvider) {
	endpoint := anthropicCompatEndpoint{
		// Same "/v1"-stripping as the OpenAI-compat path: Bifrost's
		// Anthropic provider appends the full "/v1/messages" path itself.
		baseURL:  normalizeOpenAICompatBaseURL(credBaseURL(cred)),
		keyless:  strings.TrimSpace(cred.APIKey) == "",
		baseType: bfschemas.Anthropic,
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|keyless=%t", endpoint.baseURL, endpoint.keyless)))
	return endpoint, bfschemas.ModelProvider(anthropicCompatPrefix + hex.EncodeToString(sum[:8]))
}

// anthropicCompatProviderKey derives the provider key for an Anthropic
// credential with a base-URL override.
func anthropicCompatProviderKey(cred domain.Credential) bfschemas.ModelProvider {
	_, key := anthropicCompatEndpointForCred(cred)
	return key
}

// geminiCompatPrefix namespaces derived provider keys for Gemini credentials
// served through the Agent Platform door, the way anthropicCompatPrefix does
// for self-hosted Anthropic endpoints. A distinct prefix keeps the two
// derivations from ever colliding in the shared registry.
const geminiCompatPrefix = "gemini-url-"

// geminiAgentPlatformEndpointForCred derives the endpoint identity and
// provider key for a Gemini credential carrying a project and location — an
// Agent Platform key, Gemini's second door. Bifrost's Gemini provider
// appends "/models/{model}:generateContent" to its base URL and sends the
// key as `x-goog-api-key`, both verified to be exactly what Agent Platform
// serves, so the whole door is a base-URL prefix naming the project and
// location. See specs/model-providers/google-agent-platform.feature.
func geminiAgentPlatformEndpointForCred(cred domain.Credential) (anthropicCompatEndpoint, bfschemas.ModelProvider) {
	endpoint := anthropicCompatEndpoint{
		baseURL: fmt.Sprintf(
			"https://aiplatform.googleapis.com/v1/projects/%s/locations/%s/publishers/google",
			url.PathEscape(cred.Extra["project_id"]),
			url.PathEscape(cred.Extra["region"]),
		),
		keyless:  false,
		baseType: bfschemas.Gemini,
	}
	sum := sha256.Sum256([]byte(fmt.Sprintf("%s|keyless=%t", endpoint.baseURL, endpoint.keyless)))
	return endpoint, bfschemas.ModelProvider(geminiCompatPrefix + hex.EncodeToString(sum[:8]))
}

// geminiCompatProviderKey derives the provider key for a Gemini credential
// with Agent Platform routing fields.
func geminiCompatProviderKey(cred domain.Credential) bfschemas.ModelProvider {
	_, key := geminiAgentPlatformEndpointForCred(cred)
	return key
}

// credentialIsAgentPlatform reports whether a Gemini credential names the
// Agent Platform door: both routing fields present, per the materialiser's
// contract (config.materialiser.ts emits project_id and region together or
// not at all).
func credentialIsAgentPlatform(cred domain.Credential) bool {
	return cred.Extra["project_id"] != "" && cred.Extra["region"] != ""
}

// compatEndpointForCred picks the derivation matching the credential — the
// registry stores both kinds of derived endpoint, and the credential's
// provider says which one this is.
func compatEndpointForCred(cred domain.Credential) (anthropicCompatEndpoint, bfschemas.ModelProvider) {
	if cred.ProviderID == domain.ProviderGemini {
		return geminiAgentPlatformEndpointForCred(cred)
	}
	return anthropicCompatEndpointForCred(cred)
}

// normalizeOpenAICompatBaseURL strips a trailing "/v1" (and trailing
// slashes) from a customer-configured base URL. OpenAI-compatible
// endpoints are conventionally configured as "http://host:8000/v1", but
// Bifrost's vLLM provider appends the full "/v1/chat/completions" path
// itself — forwarding the URL verbatim would produce ".../v1/v1/...".
func normalizeOpenAICompatBaseURL(u string) string {
	u = strings.TrimRight(u, "/")
	u = strings.TrimSuffix(u, "/v1")
	return strings.TrimRight(u, "/")
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
	errType, errCode := bfErrorTypeCode(berr)
	return &domain.UpstreamError{
		StatusCode: status,
		Body:       body,
		Message:    bfErrorMsg(berr),
		ErrorType:  errType,
		ErrorCode:  errCode,
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

// bfErrorTypeCode lifts the provider's own error discriminants (error.type /
// error.code as parsed by Bifrost's provider adapter) off a BifrostError.
// These carry the error's identity (insufficient_quota, overloaded_error,
// ThrottlingException, ...) on lanes where the native body is not captured.
func bfErrorTypeCode(e *bfschemas.BifrostError) (errType, errCode string) {
	if e == nil || e.Error == nil {
		return "", ""
	}
	if e.Error.Type != nil {
		errType = *e.Error.Type
	}
	if e.Error.Code != nil {
		errCode = *e.Error.Code
	}
	return errType, errCode
}

// upstreamStreamError converts a mid-stream BifrostError chunk into a
// structured domain.UpstreamError the SSE writer can forward faithfully.
//
// Providers can fail a 200-established stream with an in-stream error event
// whose detail nests under an `error` OBJECT (OpenAI Responses:
// {"type":"error","error":{"type","code","message","param"}}). Bifrost's
// stream schema maps only the legacy flat `message`/`code`/`param` fields, so
// for the nested shape it hands over an ErrorField with an EMPTY message
// but, on raw-forward paths (rawForwardCtx), the verbatim event body rides
// ExtraFields.RawResponse. Recover the message from there, and keep the raw
// body so the writer can forward the provider's own event bytes unchanged.
func upstreamStreamError(e *bfschemas.BifrostError) *domain.UpstreamError {
	ue := &domain.UpstreamError{Message: bfErrorMsg(e)}
	if e == nil {
		ue.Message = "provider stream error"
		return ue
	}
	ue.ErrorType, ue.ErrorCode = bfErrorTypeCode(e)
	if code := e.StatusCode; code != nil {
		ue.StatusCode = *code
	}
	raw, ok := extractRawResponseBytes(e.ExtraFields.RawResponse)
	if !ok {
		if ue.Message == "" {
			ue.Message = "provider stream error"
		}
		return ue
	}
	var event struct {
		Error *struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if sonic.Unmarshal(raw, &event) == nil && event.Error != nil {
		// The raw body IS a provider error event, forward it verbatim.
		ue.Body = raw
		if ue.Message == "" {
			ue.Message = event.Error.Message
		}
	}
	if ue.Message == "" {
		ue.Message = "provider stream error"
	}
	return ue
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
	var split domain.AudioTokenSplit
	if d := resp.Usage.PromptTokensDetails; d != nil {
		u.CacheReadTokens = d.CachedReadTokens
		u.CacheCreationTokens = d.CachedWriteTokens
		split.InputAudio = d.AudioTokens
		split.InputText = d.TextTokens
	}
	if d := resp.Usage.CompletionTokensDetails; d != nil {
		u.ReasoningTokens = d.ReasoningTokens
		split.OutputAudio = d.AudioTokens
		split.OutputText = d.TextTokens
	}
	return u.SplitAudioTokens(split)
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
	var split domain.AudioTokenSplit
	if d := resp.Usage.InputTokensDetails; d != nil {
		u.CacheReadTokens = d.CachedReadTokens
		u.CacheCreationTokens = d.CachedWriteTokens
		split.InputAudio = d.AudioTokens
		split.InputText = d.TextTokens
	}
	if d := resp.Usage.OutputTokensDetails; d != nil {
		u.ReasoningTokens = d.ReasoningTokens
		split.OutputAudio = d.AudioTokens
		split.OutputText = d.TextTokens
	}
	return u.SplitAudioTokens(split)
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
	// parseUsage extracts provider-native usage telemetry off raw SSE
	// chunk bytes on the passthrough path. Each provider's stream shape
	// differs (Gemini's `usageMetadata`, Anthropic's `message_start` +
	// `message_delta` events, etc.) so the dispatcher injects the
	// right parser at iterator-construction time. When nil, the
	// iterator skips usage extraction (final Usage() reports zeros).
	parseUsage func([]byte) (domain.Usage, bool)
	// roleSeenByChoice tracks which chat choice indices have emitted their
	// first delta, driving the leading-role repair in ensureLeadingRoleDelta
	// (see chat_stream_role.go). Lazily allocated on the first chat chunk.
	roleSeenByChoice map[int]bool
	// paramsDropped is the parameter-policy drop list for this request;
	// injected into the final usage-bearing chunk so streamed responses
	// carry the same extra_fields.params_dropped signal as sync ones.
	// Never set on raw-framing passthrough streams.
	paramsDropped []string
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
			it.err = upstreamStreamError(chunk.BifrostError)
			it.done = true
			return false
		}
		if chunk.BifrostChatResponse != nil {
			it.ensureLeadingRoleDelta(chunk.BifrostChatResponse)
			data, _ := sonic.Marshal(chunk.BifrostChatResponse)
			if chunk.BifrostChatResponse.Usage != nil {
				it.usage = extractUsage(chunk.BifrostChatResponse)
				// The usage-bearing final chunk carries the policy drop
				// signal, mirroring extra_fields.params_dropped on sync
				// responses.
				data = injectParamsDropped(data, it.paramsDropped)
			}
			it.current = data
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
			parser := it.parseUsage
			if parser == nil {
				parser = parseGeminiPassthroughUsage
			}
			//nolint:staticcheck // explicit embedded-field reference matches the parallel branches above for readability.
			if u, ok := parser(chunk.BifrostPassthroughResponse.Body); ok {
				// Merge — Anthropic streams emit prompt+cache tokens
				// once on `message_start` and a stream of output token
				// counters on `message_delta`, so a chunk-by-chunk
				// replace would drop the message_start values. Gemini
				// emits the full usageMetadata on every chunk that has
				// it, so this merge is a no-op for it.
				if u.PromptTokens > 0 {
					it.usage.PromptTokens = u.PromptTokens
				}
				if u.CompletionTokens > 0 {
					it.usage.CompletionTokens = u.CompletionTokens
				}
				if u.CacheReadTokens > 0 {
					it.usage.CacheReadTokens = u.CacheReadTokens
				}
				if u.CacheCreationTokens > 0 {
					it.usage.CacheCreationTokens = u.CacheCreationTokens
				}
				if u.CacheCreation1hTokens > 0 {
					it.usage.CacheCreation1hTokens = u.CacheCreation1hTokens
				}
				// Audio tokens merge on the same rule. A chunk that
				// reports none must not clear a count an earlier chunk
				// already carried, or a streamed audio turn prices at the
				// text rate.
				if u.InputAudioTokens > 0 {
					it.usage.InputAudioTokens = u.InputAudioTokens
				}
				if u.OutputAudioTokens > 0 {
					it.usage.OutputAudioTokens = u.OutputAudioTokens
				}
				if u.ReasoningTokens > 0 {
					it.usage.ReasoningTokens = u.ReasoningTokens
				}
				// Prefer the parser's reported total when non-zero —
				// Gemini's `totalTokenCount` can exceed prompt+completion
				// (reasoning / thinking tokens). Anthropic doesn't report
				// a total on the wire, so the parser leaves it at 0 and
				// we fall through to prompt+completion below.
				if u.TotalTokens > 0 {
					it.usage.TotalTokens = u.TotalTokens
				} else if it.usage.PromptTokens > 0 || it.usage.CompletionTokens > 0 {
					it.usage.TotalTokens = it.usage.PromptTokens + it.usage.CompletionTokens
				}
				// The two cache-write counters merge independently across
				// chunks, so keep the running usage obeying the rule that the
				// hour-long count is a portion of the total.
				it.usage = it.usage.ReconcileCacheWrites()
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
	// Gemini reports its thinking tokens OUTSIDE candidatesTokenCount
	// (totalTokenCount = promptTokenCount + candidatesTokenCount +
	// thoughtsTokenCount), unlike OpenAI, whose completion total already
	// contains them. Google bills thoughts at the output rate, so the
	// completion total has to carry them or every thinking call under-bills:
	// a 47-token answer with 196 thinking tokens billed for 47.
	thoughts := int(usage.Get("thoughtsTokenCount").Int())
	completion := int(usage.Get("candidatesTokenCount").Int()) + thoughts
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
		// The reported subset of the completion total, never priced on its own.
		ReasoningTokens: thoughts,
	}, true
}

// anthropicCacheCreation1h reads how many of a response's cache writes bought
// an hour-long entry, from Anthropic's own `usage.cache_creation` breakdown.
// Zero when the field is absent, which is what a request that did not ask for
// the extended TTL looks like, and prices the writes short-lived.
func anthropicCacheCreation1h(body []byte) int {
	if len(body) == 0 {
		return 0
	}
	return int(gjson.GetBytes(body, "usage.cache_creation.ephemeral_1h_input_tokens").Int())
}

// parseAnthropicPassthroughUsage extracts Anthropic's usage block from a
// raw /v1/messages SSE chunk. Anthropic's streaming protocol emits
// usage data twice:
//
//	event: message_start
//	data: {"type":"message_start","message":{"usage":{"input_tokens":N,
//	       "cache_creation_input_tokens":N,"cache_read_input_tokens":N,
//	       "cache_creation":{"ephemeral_5m_input_tokens":N,
//	                         "ephemeral_1h_input_tokens":N},
//	       "output_tokens":1, ...}}}
//
//	event: message_delta
//	data: {"type":"message_delta","usage":{"output_tokens":N}}
//
// The `message_start` event has the only input-side counters; subsequent
// `message_delta` events overwrite output_tokens as the response grows.
// Returns (Usage{}, false) for any other event so the iterator keeps the
// last-seen values (the final message_delta wins for completion tokens,
// the message_start wins for prompt + cache tokens).
func parseAnthropicPassthroughUsage(body []byte) (domain.Usage, bool) {
	if len(body) == 0 {
		return domain.Usage{}, false
	}
	// SSE chunks may contain multiple `event: ... / data: ...` frames in
	// one byte slice; scan all `data: {` lines so the message_start and
	// any trailing message_delta in the same buffered chunk both update
	// the running counters.
	var usage domain.Usage
	var matched bool
	scan := body
	for {
		i := bytes.Index(scan, []byte("data: {"))
		if i < 0 {
			break
		}
		scan = scan[i+len("data: "):]
		// Locate the JSON object's closing brace by scanning the
		// {...} balanced span. gjson parses a leading object regardless
		// of trailing garbage, so we hand it the slice from `{` onward.
		ev := gjson.GetBytes(scan, "type").String()
		switch ev {
		case "message_start":
			m := gjson.GetBytes(scan, "message.usage")
			if m.Exists() {
				usage.PromptTokens = int(m.Get("input_tokens").Int())
				usage.CompletionTokens = int(m.Get("output_tokens").Int())
				usage.CacheReadTokens = int(m.Get("cache_read_input_tokens").Int())
				usage.CacheCreationTokens = int(m.Get("cache_creation_input_tokens").Int())
				// How long those writes live, which decides their rate.
				// Present only when the request asked for the extended
				// TTL; absent leaves it zero and they price short-lived.
				usage.CacheCreation1hTokens = int(m.Get("cache_creation.ephemeral_1h_input_tokens").Int())
				usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
				matched = true
			}
		case "message_delta":
			u := gjson.GetBytes(scan, "usage")
			if u.Exists() {
				// message_delta only updates output_tokens; preserve the
				// input-side counters captured at message_start (carried
				// in the caller's it.usage via last-seen semantics).
				out := int(u.Get("output_tokens").Int())
				if out > 0 {
					usage.CompletionTokens = out
					// PromptTokens/CacheRead/CacheCreation stay zero in
					// this branch; the iterator's last-seen carry-over
					// keeps the message_start values intact for the
					// final Usage().
					matched = true
				}
			}
		}
	}
	if !matched {
		return domain.Usage{}, false
	}
	if usage.TotalTokens == 0 {
		usage.TotalTokens = usage.PromptTokens + usage.CompletionTokens
	}
	return usage, true
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
