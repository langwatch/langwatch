// Package llmexecutor implements services/nlpgo/app.LLMClient by combining
// the litellm-shape translator (services/nlpgo/adapters/litellm) with a
// pluggable app.GatewayClient.
//
// The LLM block in Sarah's engine talks to this executor. The executor:
//  1. parses provider+model from the LLMRequest
//  2. applies model-id rewrites (anthropic dot→dash, alias expansion)
//  3. builds the OpenAI-shape request body (messages, tools, params)
//  4. applies reasoning-model overrides + anthropic temperature clamp
//  5. normalizes reasoning_effort spelling
//  6. encodes inline credentials from litellm_params into the
//     X-LangWatch-Inline-Credentials header that the GatewayClient
//     consumes
//  7. invokes the GatewayClient (in-process dispatcher in production
//     since the library pivot)
//  8. parses the response back into app.LLMResponse
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
	"strings"
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
		provider := req.Provider
		if provider == "" {
			provider, _ = litellm.SplitProviderModel(req.Model)
		}
		return nil, &GatewayHTTPError{
			StatusCode: resp.StatusCode,
			Body:       resp.Body,
			Headers:    resp.Headers,
			Provider:   provider,
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
	// Provider names the upstream the request was dispatched to ("openai",
	// "anthropic", ...). Prefixed onto the surfaced message so the user can
	// tell a provider rejection from a LangWatch failure.
	Provider string
}

// HTTPStatusCode exposes the gateway/provider status for fault
// classification in the engine without it importing this adapter package
// (errors.As against a small interface target).
func (e *GatewayHTTPError) HTTPStatusCode() int { return e.StatusCode }

// Error implements error. Surfaces the upstream provider's message
// verbatim (parsed out of the OpenAI-shape response body), prefixed with
// the provider name when known — "openai: You exceeded your current
// quota...", "openai: Request headers are too large." — so the trace
// drawer and SSE error frame carry both the real reason AND who said it.
// The reason stays verbatim because an opaque "gateway returned non-2xx
// status 429" gives the user zero signal whether the key is invalid, the
// prompt is bad, or the account is out of credits; the provider prefix
// exists because an ambiguous provider-edge rejection ("Request headers
// are too large.") otherwise reads as a LangWatch infrastructure failure.
//
// Falls back to a status-code-only message when the body is missing,
// not JSON, or doesn't carry a recognizable error envelope — preserves
// a useful signal for callers that don't ship JSON errors (raw 5xx
// HTML, future passthrough endpoints).
func (e *GatewayHTTPError) Error() string {
	if msg := extractProviderErrorMessage(e.Body); msg != "" {
		if e.Provider != "" {
			return e.Provider + ": " + msg
		}
		return msg
	}
	return fmt.Sprintf("gateway returned non-2xx status %d", e.StatusCode)
}

// extractProviderErrorMessage pulls a human-readable message out of an
// OpenAI-shape error response. Tolerant of all real-world variations on
// the wire today: top-level `error.message`, top-level `message`, the
// LiteLLM-wrapped "litellm.RateLimitError: ..." string. Returns "" when
// the body isn't recognizable JSON — caller falls back to the bare
// status-code message.
func extractProviderErrorMessage(body []byte) string {
	if len(body) == 0 {
		return ""
	}
	var envelope struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    any    `json:"code"`
		} `json:"error"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &envelope); err != nil {
		return ""
	}
	if envelope.Error.Message != "" {
		return envelope.Error.Message
	}
	return envelope.Message
}

// buildGatewayRequest performs all the shape mapping in one place so the
// streaming and non-streaming paths share identical translation logic.
func buildGatewayRequest(ctx context.Context, req app.LLMRequest, stream bool) (app.GatewayRequest, error) {
	// req.Provider is authoritative when set: the engine strips the
	// provider prefix in `splitModel` (engine.go) and stores it there.
	// Splitting req.Model first would mis-derive the provider for custom
	// model ids that contain a slash of their own — "custom/Qwen/Qwen2.5"
	// arrives here as Model "Qwen/Qwen2.5" + Provider "custom", and the
	// split would yield provider "qwen".
	provider := req.Provider
	if provider == "" {
		provider, _ = litellm.SplitProviderModel(req.Model)
	}
	if provider == "" {
		return app.GatewayRequest{}, fmt.Errorf("could not infer provider from model %q", req.Model)
	}

	// Reconstruct the prefixed model id before TranslateModelID so its
	// providersNeedingDotToDash gate can see the provider — without
	// re-prefixing, TranslateModelID falls to its empty-provider safety
	// branch (treats as anthropic-like) and dot→dashes every model id,
	// mangling Gemini + Vertex + Gemini's 2.5 family on the
	// inline-credentials path. Prefix-check (not just slash-check) so a
	// custom model id like "Qwen/Qwen2.5-32B-Instruct" still gets its
	// "custom/" prefix restored.
	prefixedModel := req.Model
	if !strings.HasPrefix(req.Model, provider+"/") {
		prefixedModel = provider + "/" + req.Model
	}
	translatedModel := litellm.TranslateModelID(prefixedModel)
	gatewayProvider := litellm.GatewayProviderForModel(provider)

	// Build the OpenAI-shape body. Empty-content messages are filtered
	// before marshaling — Anthropic strictly rejects messages with empty
	// text content blocks ("text content blocks must be non-empty"),
	// and OpenAI tolerates the removal silently. Mirrors the Python
	// _filter_empty_content_messages guard from langwatch_nlp regression
	// 1ed2c7fdf.
	body := map[string]any{
		"model":    translatedModelOrInferred(translatedModel, gatewayProvider, req.Model),
		"messages": filterEmptyContentMessages(req.Messages),
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
		// Bedrock + Anthropic: don't ship response_format. bifrost v1.4.22's
		// bedrock provider routes response_format on anthropic-family
		// models (any model whose id contains "anthropic." or "claude")
		// through Anthropic's native output_config.format extension via
		// additionalModelRequestFields (providers/bedrock/utils.go:1011-
		// 1015). That field is a Bedrock+Anthropic feature that ships with
		// rolling per-region / per-model-version support and requires the
		// right anthropic-beta header to activate; when the combination
		// doesn't line up the field is silently ignored and the model
		// returns prose. Customer dogfood 2026-05-30 caught this on
		// us.anthropic.claude-haiku-4-5-* via a managed-bedrock VPCE: a
		// signature node with {output:bool, reason:str} got raw
		// "TRUE\n\nReason: ..." back, the engine's extractSignatureOutputs
		// then fell through to the prose-fallback and dumped the whole
		// blob into the first declared field.
		//
		// LiteLLM (python langwatch_nlp's path) bypasses this entirely:
		// it translates response_format → toolConfig.tools + toolChoice
		// (forced tool_use), which is the oldest and most universally
		// supported Anthropic structured-output mechanism. Every claude
		// model in every region honors it, no beta header required. We
		// mirror that translation here so the Go path has python parity
		// + the same robustness profile.
		//
		// Conversion is one-shot and self-contained: build a synthetic
		// tool whose input schema IS the response_format schema, append
		// it to the tools array, pin tool_choice to it, then drop
		// response_format from the body. The response side
		// (parseChatCompletionResponse) lifts the tool_call arguments
		// back into Content so engine.extractSignatureOutputs sees the
		// same JSON-shape payload it would have received from
		// response_format on a provider that does honor it natively.
		if shouldUseToolUseForStructuredOutput(provider, req.Model) {
			if tool, choice, ok := buildStructuredOutputTool(req.ResponseFormat); ok {
				existingTools, _ := body["tools"].([]app.Tool)
				body["tools"] = append(existingTools, tool)
				body["tool_choice"] = choice
			} else {
				// Schema malformed (no "json_schema.schema"). Fall back to
				// the response_format pass-through so providers that DO
				// honor a top-level response_format get something rather
				// than nothing — same defensive posture as the recoverJSON
				// fallback in the engine.
				body["response_format"] = req.ResponseFormat
			}
		} else {
			body["response_format"] = req.ResponseFormat
		}
	}
	if stream {
		body["stream"] = true
	}

	// Apply the preserved post-DSPy behaviors.
	litellm.NormalizeReasoningEffort(body)
	// Floor max_tokens for any reasoning-enabled config — runs before
	// ApplyReasoningOverrides so OpenAI reasoning models inherit the
	// floor when the override migrates max_tokens → max_completion_tokens.
	litellm.EnsureReasoningMaxTokens(body)
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

// structuredOutputToolPrefix marks tools synthesized from
// response_format. parseChatCompletionResponse unwraps tool_calls whose
// function name starts with this prefix back into Content so the engine
// sees the same JSON-shape payload as the response_format path. The
// prefix mirrors bifrost's internal `bf_so_` convention but stays
// nlpgo-owned so a bifrost rename can't silently break us.
const structuredOutputToolPrefix = "lw_so_"

// shouldUseToolUseForStructuredOutput returns true when response_format
// must be rewritten to a forced tool_use call. Today: any Anthropic-family
// model dispatched via Bedrock. Bifrost v1.4.22's bedrock provider routes
// response_format on anthropic-family models through Anthropic's native
// output_config.format extension which has variable per-region /
// per-model-version support (customer dogfood 2026-05-30 with
// us.anthropic.claude-haiku-4-5 returned prose). Tool_use is the oldest,
// universally-supported Anthropic structured-output path.
//
// Match policy mirrors bifrost's IsAnthropicModel: any "anthropic." OR
// "claude" substring in the model id. The provider gate ensures we don't
// pre-empt direct Anthropic or other providers where the native
// response_format path is well-supported.
func shouldUseToolUseForStructuredOutput(provider, model string) bool {
	if provider != "bedrock" {
		return false
	}
	return strings.Contains(model, "anthropic.") || strings.Contains(model, "claude")
}

// buildStructuredOutputTool converts a response_format json_schema into
// a forced-tool-call pair: the tool whose input_schema IS the json_schema
// `schema` payload, and a tool_choice that pins the model to call it.
// Returns ok=false when the response_format isn't a json_schema OR the
// schema property is missing — caller falls back to passing
// response_format through unchanged.
func buildStructuredOutputTool(rf *app.ResponseFormat) (app.Tool, map[string]any, bool) {
	if rf == nil || rf.Type != "json_schema" || rf.JSONSchema == nil {
		return app.Tool{}, nil, false
	}
	// Schema must be an object. Strings, numbers, arrays, etc. would
	// produce a tool with an invalid `parameters` field that bedrock
	// rejects with a 400. Fall back to passing response_format through
	// unchanged so the malformed payload at least reaches the upstream
	// validator with a recognizable shape instead of being silently
	// reshaped on the way out.
	schema, ok := rf.JSONSchema["schema"].(map[string]any)
	if !ok {
		return app.Tool{}, nil, false
	}
	name, _ := rf.JSONSchema["name"].(string)
	if name == "" {
		name = "Outputs"
	}
	toolName := structuredOutputToolPrefix + name
	function := map[string]any{
		"name":        toolName,
		"description": "Return the response as a JSON object matching the declared output schema.",
		"parameters":  schema,
	}
	// Anthropic's JSON-schema-via-tool-use accepts strict-mode just like
	// OpenAI's response_format. Preserve it when the engine asked for it
	// so the model honors required/additionalProperties.
	if strict, ok := rf.JSONSchema["strict"].(bool); ok && strict {
		function["strict"] = true
	}
	tool := app.Tool{Type: "function", Function: function}
	choice := map[string]any{
		"type":     "function",
		"function": map[string]any{"name": toolName},
	}
	return tool, choice, true
}

// liftStructuredOutputToolArgs returns the `arguments` payload of the
// first tool_call whose function name carries the structuredOutputToolPrefix.
// Matches the tools we synthesized in buildStructuredOutputTool; ignores
// caller-supplied tools so a workflow that mixes its own tool_use with a
// signature node's structured output isn't accidentally collapsed.
func liftStructuredOutputToolArgs(toolCalls []app.ToolCall) (string, bool) {
	for _, tc := range toolCalls {
		if tc.Type != "function" {
			continue
		}
		name, _ := tc.Function["name"].(string)
		if !strings.HasPrefix(name, structuredOutputToolPrefix) {
			continue
		}
		args, _ := tc.Function["arguments"].(string)
		if args == "" {
			continue
		}
		return args, true
	}
	return "", false
}

// translatedModelOrInferred returns the BARE model id we put on the wire
// in the JSON body. The provider prefix ("openai/", "anthropic/", …) is
// for routing only — Bifrost picks the provider from Credential.ProviderID
// and the underlying provider API rejects a request whose body.model
// carries the langwatch-internal prefix (OpenAI 400s on "openai/gpt-5-mini").
//
// For custom OpenAI-compatible providers (Together, Mistral, Groq, …) the
// caller's `api_base` in litellm_params already routes the request away
// from canonical OpenAI; the bare model id is what the custom endpoint
// expects.
func translatedModelOrInferred(translated, gatewayProvider, original string) string {
	_, bareTranslated := litellm.SplitProviderModel(translated)
	if bareTranslated != "" {
		return bareTranslated
	}
	// Defensive fall-back: if the translated id had no provider prefix
	// (shouldn't happen for any of the providers we route), emit it
	// verbatim so the original behavior is preserved.
	_ = gatewayProvider
	_ = original
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
				Role             string         `json:"role"`
				Content          any            `json:"content"`
				ReasoningContent string         `json:"reasoning_content"`
				ToolCalls        []app.ToolCall `json:"tool_calls"`
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
		ToolCalls: choice.Message.ToolCalls,
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
	// When the request used the buildStructuredOutputTool rewrite
	// (bedrock + anthropic-family + response_format), the model returns
	// its JSON payload as the synthetic tool's `arguments` instead of
	// text content. Lift it back into Content so the engine's
	// extractSignatureOutputs sees the same JSON-shape payload it would
	// have received from a provider that honored response_format
	// natively — no engine-side branch needed.
	if out.Content == "" {
		if args, ok := liftStructuredOutputToolArgs(choice.Message.ToolCalls); ok {
			out.Content = args
		}
	}
	out.Messages = []app.ChatMessage{{
		Role:             choice.Message.Role,
		Content:          choice.Message.Content,
		ReasoningContent: choice.Message.ReasoningContent,
		ToolCalls:        choice.Message.ToolCalls,
	}}
	return out, nil
}

// filterEmptyContentMessages drops messages with no usable content
// before they reach the gateway. Mirrors langwatch_nlp's
// _filter_empty_content_messages (regression 1ed2c7fdf): Anthropic
// rejects messages with empty text content blocks ("text content
// blocks must be non-empty") with a 400, and OpenAI tolerates the
// removal silently. The filter applies unconditionally — an empty
// message has no information to convey regardless of provider.
//
// Behavior, matching the Python equivalent:
//   - Drops messages with nil content.
//   - Drops messages with whitespace-only or empty string content.
//   - For list-of-blocks content (multimodal): drops empty text
//     blocks; preserves non-text blocks (images, structured data);
//     drops the entire message when ALL blocks were empty (an empty
//     content list still 400s Anthropic).
//   - Preserves messages with assistant-only tool-call payloads even
//     when their text content is empty — the tool call itself is the
//     load-bearing content.
func filterEmptyContentMessages(messages []app.ChatMessage) []app.ChatMessage {
	if len(messages) == 0 {
		return messages
	}
	out := make([]app.ChatMessage, 0, len(messages))
	for _, m := range messages {
		// Tool-call payload counts as content even if text is empty.
		if len(m.ToolCalls) > 0 {
			out = append(out, m)
			continue
		}
		switch c := m.Content.(type) {
		case nil:
			continue
		case string:
			if strings.TrimSpace(c) == "" {
				continue
			}
			out = append(out, m)
		case []any:
			filtered := make([]any, 0, len(c))
			for _, b := range c {
				block, ok := b.(map[string]any)
				if !ok {
					filtered = append(filtered, b)
					continue
				}
				if t, _ := block["type"].(string); t != "text" {
					filtered = append(filtered, b)
					continue
				}
				text, _ := block["text"].(string)
				if strings.TrimSpace(text) != "" {
					filtered = append(filtered, b)
				}
			}
			if len(filtered) == 0 {
				continue
			}
			msgCopy := m
			msgCopy.Content = filtered
			out = append(out, msgCopy)
		default:
			// Other content shapes (e.g. typed message structs) flow
			// through unchanged — only the explicit empty cases above
			// trigger removal.
			out = append(out, m)
		}
	}
	return out
}
