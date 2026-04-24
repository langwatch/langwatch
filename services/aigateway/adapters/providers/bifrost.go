// Package providers wraps bifrost as the provider dispatch engine.
// All AI providers (OpenAI, Anthropic, Azure, Bedrock, Vertex, Gemini)
// are handled by a single bifrost instance. Per-request credentials
// come from context via the Account interface.
package providers

import (
	"context"
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
// The inbound body is assumed to be OpenAI-shape (what the gateway exposes
// on /v1/chat/completions). Bifrost normalizes from this shape to the
// provider's native wire format (Anthropic Messages API, Gemini
// generateContent, etc.) and un-normalizes the response back. See
// parseOpenAIChatRequest for the field mapping; Bifrost's per-provider
// adapters (core/providers/*) handle the per-provider quirks
// (stream_options strip, tool-schema rewrite, system-role hoist, etc.).
func (r *BifrostRouter) Dispatch(ctx context.Context, req *domain.Request, cred domain.Credential) (*domain.Response, error) {
	provider := mapProvider(cred.ProviderID)
	model := req.Model
	if req.Resolved != nil {
		model = req.Resolved.ModelID
	}

	messages, params, err := parseOpenAIChatRequest(req.Body)
	if err != nil {
		return nil, err
	}
	bfReq := &bfschemas.BifrostChatRequest{
		Provider: provider,
		Model:    model,
		Input:    messages,
		Params:   params,
	}

	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	resp, berr := r.bf.ChatCompletionRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, classifyBifrostError(ctx, berr)
	}

	body, _ := sonic.Marshal(resp)
	return &domain.Response{
		Body:       body,
		StatusCode: http.StatusOK,
		Usage:      extractUsage(resp),
	}, nil
}

// DispatchStream sends a streaming request through bifrost. Normalized
// request shape same as Dispatch; chunks returned by Bifrost are already
// BifrostChatResponse (OpenAI-compatible), so the SSE bytes we emit
// downstream are the shape the OpenAI SDK expects regardless of which
// provider Bifrost routed to.
func (r *BifrostRouter) DispatchStream(ctx context.Context, req *domain.Request, cred domain.Credential) (domain.StreamIterator, error) {
	provider := mapProvider(cred.ProviderID)
	model := req.Model
	if req.Resolved != nil {
		model = req.Resolved.ModelID
	}

	messages, params, err := parseOpenAIChatRequest(req.Body)
	if err != nil {
		return nil, err
	}
	bfReq := &bfschemas.BifrostChatRequest{
		Provider: provider,
		Model:    model,
		Input:    messages,
		Params:   params,
	}

	bfCtx := bfschemas.NewBifrostContext(withCredential(ctx, cred), time.Time{})

	ch, berr := r.bf.ChatCompletionStreamRequest(bfCtx, bfReq)
	if berr != nil {
		return nil, classifyBifrostError(ctx, berr)
	}

	return &bifrostStreamIterator{ch: ch}, nil
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
			Endpoint: envVar(endpoint),
		}
		if apiVersion, ok := cred.Extra["api_version"]; ok {
			v := envVar(apiVersion)
			cfg.APIVersion = &v
		}
		k.AzureKeyConfig = cfg

	case bfschemas.Bedrock:
		cfg := &bfschemas.BedrockKeyConfig{
			AccessKey: envVar(cred.Extra["access_key"]),
			SecretKey: envVar(cred.Extra["secret_key"]),
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
