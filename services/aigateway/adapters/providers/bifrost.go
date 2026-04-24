// Package providers wraps bifrost as the provider dispatch engine.
// All AI providers (OpenAI, Anthropic, Azure, Bedrock, Vertex, Gemini)
// are handled by a single bifrost instance. Per-request credentials
// come from context via the Account interface.
package providers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"

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
	return &BifrostRouter{bf: bf, logger: opts.Logger}, nil
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
	provider := mapProvider(cred.ProviderID)
	model := req.Model
	if req.Resolved != nil {
		model = req.Resolved.ModelID
	}

	if req.Type == domain.RequestTypeResponses {
		return r.dispatchResponses(ctx, req, provider, model, cred)
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
			}, nil
		}
		return nil, classifyBifrostError(ctx, berr)
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
			}, nil
		}
		return nil, classifyBifrostError(ctx, berr)
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

	bfReq, dispatchCtx, err := buildChatRequest(ctx, req, provider, model)
	if err != nil {
		return nil, err
	}

	bfCtx := bfschemas.NewBifrostContext(withCredential(dispatchCtx, cred), time.Time{})

	ch, berr := r.bf.ChatCompletionStreamRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, classifyBifrostError(ctx, berr)
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
		return nil, classifyBifrostError(ctx, berr)
	}
	return &bifrostStreamIterator{ch: ch}, nil
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

func (a *account) GetConfigForProvider(provider bfschemas.ModelProvider) (*bfschemas.ProviderConfig, error) {
	cfg := &bfschemas.ProviderConfig{}
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
		cfg := &bfschemas.BedrockKeyConfig{
			AccessKey:   envVar(cred.Extra["access_key"]),
			SecretKey:   envVar(cred.Extra["secret_key"]),
			Deployments: cred.DeploymentMap,
		}
		if st, ok := cred.Extra["session_token"]; ok && st != "" {
			v := envVar(st)
			cfg.SessionToken = &v
		}
		if region, ok := cred.Extra["region"]; ok && region != "" {
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
	return domain.Usage{
		PromptTokens:     resp.Usage.PromptTokens,
		CompletionTokens: resp.Usage.CompletionTokens,
		TotalTokens:      resp.Usage.TotalTokens,
	}
}

// extractResponsesUsage maps the Responses-API usage block onto the
// gateway's neutral domain.Usage. The Responses API uses
// input/output/total_tokens (not prompt/completion) — same numeric
// content, different names.
func extractResponsesUsage(resp *bfschemas.BifrostResponsesResponse) domain.Usage {
	if resp == nil || resp.Usage == nil {
		return domain.Usage{}
	}
	return domain.Usage{
		PromptTokens:     resp.Usage.InputTokens,
		CompletionTokens: resp.Usage.OutputTokens,
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
				u := chunk.BifrostChatResponse.Usage
				it.usage = domain.Usage{
					PromptTokens:     u.PromptTokens,
					CompletionTokens: u.CompletionTokens,
					TotalTokens:      u.TotalTokens,
				}
			}
		} else if chunk.BifrostResponsesStreamResponse != nil {
			// Responses API stream frames (response.created /
			// response.output_text.delta / response.completed / ...).
			// Marshal verbatim — clients using the OpenAI Responses SDK
			// decode these by `type`. Final usage appears on the
			// response.completed event's nested Response object.
			data, _ := sonic.Marshal(chunk.BifrostResponsesStreamResponse)
			it.current = data
			if resp := chunk.BifrostResponsesStreamResponse.Response; resp != nil && resp.Usage != nil {
				u := resp.Usage
				it.usage = domain.Usage{
					PromptTokens:     u.InputTokens,
					CompletionTokens: u.OutputTokens,
					TotalTokens:      u.TotalTokens,
				}
			}
		}
		return true
	}
}

func (it *bifrostStreamIterator) Chunk() []byte       { return it.current }
func (it *bifrostStreamIterator) Usage() domain.Usage { return it.usage }
func (it *bifrostStreamIterator) Err() error          { return it.err }
func (it *bifrostStreamIterator) Close() error        { return nil }

// --- Bifrost logger adapter ---

type bifrostLogger struct {
	logger *zap.Logger
}

func (l *bifrostLogger) Debug(msg string, args ...any) { l.logger.Debug(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) Info(msg string, args ...any)  { l.logger.Info(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) Warn(msg string, args ...any)  { l.logger.Warn(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) Error(msg string, args ...any) { l.logger.Error(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) Fatal(msg string, args ...any) { l.logger.Fatal(fmt.Sprintf(msg, args...)) }
func (l *bifrostLogger) SetLevel(_ bfschemas.LogLevel)              {}
func (l *bifrostLogger) SetOutputType(_ bfschemas.LoggerOutputType) {}
func (l *bifrostLogger) LogHTTPRequest(_ bfschemas.LogLevel, _ string) bfschemas.LogEventBuilder {
	return bfschemas.NoopLogEvent
}
