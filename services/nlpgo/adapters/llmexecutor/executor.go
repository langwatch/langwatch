// Package llmexecutor implements services/nlpgo/app.LLMClient by combining
// the litellm-shape translator (services/nlpgo/adapters/litellm) with a
// pluggable app.GatewayClient.
//
// The LLM block in Sarah's engine talks to this executor. The executor:
//   1. parses provider+model from the LLMRequest
//   2. applies model-id rewrites (anthropic dot→dash, alias expansion)
//   3. builds the OpenAI-shape request body (messages, tools, params)
//   4. applies reasoning-model overrides + anthropic temperature clamp
//   5. normalizes reasoning_effort spelling
//   6. encodes inline credentials from litellm_params into the
//      X-LangWatch-Inline-Credentials header that the GatewayClient
//      consumes
//   7. invokes the GatewayClient (in-process dispatcher in production
//      since the library pivot)
//   8. parses the response back into app.LLMResponse
//
// All providers route through chat/completions — Bifrost's per-provider
// adapter handles native-format translation downstream. This matches the
// existing langwatch_nlp + LiteLLM behavior (everything went through
// chat/completions).
package llmexecutor

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/langwatch/langwatch/services/nlpgo/adapters/litellm"
	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// Header names llmexecutor sets on the GatewayRequest. The active
// GatewayClient implementation (today: dispatcheradapter) reads these
// to assemble its in-process dispatcher.Request. The names match the
// pre-library-pivot HTTP wire format so a future direct-Credential
// refactor can drop them in lockstep with the consumer.
const (
	headerInlineCredentials = "X-LangWatch-Inline-Credentials"
	headerOrigin            = "X-LangWatch-Origin"
)

// Executor implements app.LLMClient.
type Executor struct {
	gw app.GatewayClient
}

// New builds an Executor from a GatewayClient. The gateway client owns
// HTTP transport, signing, and base URL; the executor is pure shape
// translation.
func New(gw app.GatewayClient) *Executor {
	return &Executor{gw: gw}
}

// Compile-time interface check.
var _ app.LLMClient = (*Executor)(nil)

// Execute runs a single LLM call, blocking until the response arrives.
func (e *Executor) Execute(ctx context.Context, req app.LLMRequest) (*app.LLMResponse, error) {
	gwReq, err := buildGatewayRequest(ctx, req, false)
	if err != nil {
		return nil, err
	}
	start := time.Now()
	resp, err := e.gw.ChatCompletions(ctx, gwReq)
	if err != nil {
		return nil, fmt.Errorf("gateway chat/completions: %w", err)
	}
	durationMS := time.Since(start).Milliseconds()
	if resp.StatusCode/100 != 2 {
		return nil, &GatewayHTTPError{
			StatusCode: resp.StatusCode,
			Body:       resp.Body,
			Headers:    resp.Headers,
		}
	}
	return parseChatCompletionResponse(resp.Body, durationMS)
}

// ExecuteStream opens a streaming /v1/chat/completions request and returns
// a StreamIterator the caller pumps for incremental deltas.
func (e *Executor) ExecuteStream(ctx context.Context, req app.LLMRequest) (app.StreamIterator, error) {
	gwReq, err := buildGatewayRequest(ctx, req, true)
	if err != nil {
		return nil, err
	}
	return e.gw.ChatCompletionsStream(ctx, gwReq)
}

// GatewayHTTPError surfaces a non-2xx gateway response so the caller (the
// LLM block in the engine) can decide whether to retry or to convert it
// to an SSE error event for the client.
type GatewayHTTPError struct {
	StatusCode int
	Body       []byte
	Headers    map[string]string
}

// Error implements error.
func (e *GatewayHTTPError) Error() string {
	return fmt.Sprintf("gateway returned non-2xx status %d", e.StatusCode)
}

// buildGatewayRequest performs all the shape mapping in one place so the
// streaming and non-streaming paths share identical translation logic.
func buildGatewayRequest(ctx context.Context, req app.LLMRequest, stream bool) (app.GatewayRequest, error) {
	provider, _ := litellm.SplitProviderModel(req.Model)
	if provider == "" {
		// Some workflows store the provider on the LLMRequest separately —
		// honor that as a fall-back.
		provider = req.Provider
	}
	if provider == "" {
		return app.GatewayRequest{}, fmt.Errorf("could not infer provider from model %q", req.Model)
	}

	translatedModel := litellm.TranslateModelID(req.Model)
	gatewayProvider := litellm.GatewayProviderForModel(provider)

	// Build the OpenAI-shape body.
	body := map[string]any{
		"model":    translatedModelOrInferred(translatedModel, gatewayProvider, req.Model),
		"messages": req.Messages,
	}
	if len(req.Tools) > 0 {
		body["tools"] = req.Tools
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	if req.MaxTokens != nil {
		body["max_tokens"] = *req.MaxTokens
	}
	if req.TopP != nil {
		body["top_p"] = *req.TopP
	}
	if req.ReasoningEffort != "" {
		body["reasoning_effort"] = req.ReasoningEffort
	}
	if req.ResponseFormat != nil {
		body["response_format"] = req.ResponseFormat
	}
	if stream {
		body["stream"] = true
	}

	// Apply the preserved post-DSPy behaviors.
	litellm.NormalizeReasoningEffort(body)
	litellm.ApplyReasoningOverrides(translatedModel, body)
	litellm.ClampAnthropicTemperature(provider, body)

	// Build inline credentials from litellm_params.
	creds, err := litellm.FromLiteLLMParams(provider, req.LiteLLMParams)
	if err != nil {
		return app.GatewayRequest{}, fmt.Errorf("translate litellm_params: %w", err)
	}
	credsHeader, err := creds.Encode()
	if err != nil {
		return app.GatewayRequest{}, err
	}

	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return app.GatewayRequest{}, fmt.Errorf("marshal request body: %w", err)
	}

	headers := map[string]string{
		headerInlineCredentials: credsHeader,
	}
	for k, v := range req.Headers {
		headers[k] = v
	}
	if origin, ok := originFromContext(ctx); ok {
		headers[headerOrigin] = origin
	}

	return app.GatewayRequest{
		Body:    bodyBytes,
		Headers: headers,
		Model:   translatedModel,
		Project: req.ProjectID,
	}, nil
}

// translatedModelOrInferred returns the model id we put on the wire to the
// gateway. For custom providers we translate the prefix to "openai/" so the
// gateway dispatches via Bifrost's openai-compat path; for everything else
// the post-translation id is fine.
func translatedModelOrInferred(translated, gatewayProvider, original string) string {
	originalProvider, originalModel := litellm.SplitProviderModel(original)
	if originalProvider == "custom" {
		// custom/<model> → openai/<model> at gateway boundary.
		_ = gatewayProvider
		return "openai/" + originalModel
	}
	return translated
}

// originFromContext extracts the X-LangWatch-Origin propagation value from
// the request context, set by Sarah's engine via originctx.With().
//
// We honor it via a typed context-key abstraction so the executor doesn't
// need to know about the engine's internal package layout. If the engine
// hasn't attached an origin (e.g. unit tests) we just don't set the header
// and the gateway records "unknown".
func originFromContext(ctx context.Context) (string, bool) {
	v := ctx.Value(originContextKey{})
	if s, ok := v.(string); ok && s != "" {
		return s, true
	}
	return "", false
}

// originContextKey is duplicated here to avoid a dependency cycle with the
// engine package. The engine sets the same key (string-typed via reflection
// on the same struct) — it's a one-off cost; we centralize in app/originctx
// in a follow-up.
type originContextKey struct{}

// WithOrigin attaches an origin tag to ctx so the executor can echo it on
// outbound gateway requests. Engine handlers should call this at request
// boundary; tests use it directly.
func WithOrigin(ctx context.Context, origin string) context.Context {
	return contextWithValue(ctx, originContextKey{}, origin)
}

// contextWithValue wraps context.WithValue so we don't leak the
// originContextKey symbol outside this package.
func contextWithValue(ctx context.Context, key, val any) context.Context {
	return context.WithValue(ctx, key, val)
}

// parseChatCompletionResponse decodes an OpenAI-shape /v1/chat/completions
// JSON body into our LLMResponse. Tool calls and structured-output content
// pass through untouched (the engine does not re-interpret them).
func parseChatCompletionResponse(body []byte, durationMS int64) (*app.LLMResponse, error) {
	var raw struct {
		Choices []struct {
			Message struct {
				Role      string         `json:"role"`
				Content   any            `json:"content"`
				ToolCalls []app.ToolCall `json:"tool_calls"`
			} `json:"message"`
			FinishReason string `json:"finish_reason"`
		} `json:"choices"`
		Usage struct {
			PromptTokens     int `json:"prompt_tokens"`
			CompletionTokens int `json:"completion_tokens"`
			TotalTokens      int `json:"total_tokens"`
			ReasoningTokens  int `json:"reasoning_tokens"`
		} `json:"usage"`
	}
	if err := json.Unmarshal(body, &raw); err != nil {
		return nil, fmt.Errorf("decode chat/completions response: %w", err)
	}
	if len(raw.Choices) == 0 {
		return nil, fmt.Errorf("chat/completions response has no choices")
	}
	choice := raw.Choices[0]

	out := &app.LLMResponse{
		ToolCalls:  choice.Message.ToolCalls,
		Usage: app.Usage{
			PromptTokens:     raw.Usage.PromptTokens,
			CompletionTokens: raw.Usage.CompletionTokens,
			TotalTokens:      raw.Usage.TotalTokens,
			ReasoningTokens:  raw.Usage.ReasoningTokens,
		},
		Raw:        body,
		DurationMS: durationMS,
	}
	if s, ok := choice.Message.Content.(string); ok {
		out.Content = s
	}
	out.Messages = []app.ChatMessage{{
		Role:      choice.Message.Role,
		Content:   choice.Message.Content,
		ToolCalls: choice.Message.ToolCalls,
	}}
	return out, nil
}
