package llmexecutor

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/nlpgo/app"
)

// fakeGateway captures the GatewayRequest that the executor builds, lets
// us assert on every translation step (model id, body, headers, inline
// credentials) without spinning up an HTTP server.
type fakeGateway struct {
	lastReq    app.GatewayRequest
	respBody   []byte
	respStatus int
	respErr    error
}

func (f *fakeGateway) ChatCompletions(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	f.lastReq = req
	if f.respErr != nil {
		return nil, f.respErr
	}
	return &app.GatewayResponse{
		StatusCode: f.respStatus,
		Body:       f.respBody,
		Headers:    map[string]string{},
	}, nil
}
func (f *fakeGateway) ChatCompletionsStream(ctx context.Context, req app.GatewayRequest) (app.StreamIterator, error) {
	f.lastReq = req
	return nil, errors.New("not used in these tests")
}
func (f *fakeGateway) Messages(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return f.ChatCompletions(ctx, req)
}
func (f *fakeGateway) MessagesStream(ctx context.Context, req app.GatewayRequest) (app.StreamIterator, error) {
	return f.ChatCompletionsStream(ctx, req)
}
func (f *fakeGateway) Responses(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return f.ChatCompletions(ctx, req)
}
func (f *fakeGateway) ResponsesStream(ctx context.Context, req app.GatewayRequest) (app.StreamIterator, error) {
	return f.ChatCompletionsStream(ctx, req)
}
func (f *fakeGateway) Embeddings(ctx context.Context, req app.GatewayRequest) (*app.GatewayResponse, error) {
	return f.ChatCompletions(ctx, req)
}

// successResponse is a minimal OpenAI-shape chat completion that the
// parser accepts. Tests can override fields per case.
func successResponse(content string) []byte {
	return []byte(`{
		"id":"chatcmpl-1",
		"choices":[{
			"index":0,
			"message":{"role":"assistant","content":"` + content + `"},
			"finish_reason":"stop"
		}],
		"usage":{"prompt_tokens":10,"completion_tokens":2,"total_tokens":12}
	}`)
}

func TestExecute_HappyPathOpenAI(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("hi")}
	exec := New(gw)

	resp, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:    "openai/gpt-5-mini",
		Messages: []app.ChatMessage{{Role: "user", Content: "hello"}},
		LiteLLMParams: map[string]any{
			"api_key": "sk-test",
		},
		ProjectID: "proj_acme",
	})
	if err != nil {
		t.Fatalf("Execute: %v", err)
	}
	if resp.Content != "hi" {
		t.Errorf("expected content hi, got %q", resp.Content)
	}
	if len(resp.Messages) != 1 || resp.Messages[0].Role != "assistant" {
		t.Errorf("expected 1 assistant message, got %#v", resp.Messages)
	}
	if resp.Usage.TotalTokens != 12 {
		t.Errorf("expected total_tokens 12, got %d", resp.Usage.TotalTokens)
	}
}

func TestExecute_AnthropicModelIDDotToDash(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:         "anthropic/claude-opus-4.5",
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := bodyField(t, gw.lastReq.Body, "model")
	if got != "claude-opus-4-5" {
		t.Errorf("expected anthropic dot→dash on bare model, got %q", got)
	}
}

// TestExecute_GeminiPrefixStrippedDoesNotMangleDots is the regression
// test for the iter-21 Gemini bug. The engine's runSignature splits the
// canonical "<provider>/<model>" id into separate Model + Provider
// fields before constructing app.LLMRequest. With only the bare model
// in req.Model, TranslateModelID's empty-provider safety branch fires
// and dot→dashes the id (intended for bare anthropic model names like
// "claude-3.5-sonnet"). For gemini/vertex/etc. that mangling silently
// breaks the upstream call (`gemini-2.5-flash` → `gemini-2-5-flash`,
// 404 from Google). Fix: reconstruct the prefixed id from req.Provider
// before calling TranslateModelID.
func TestExecute_GeminiBareModelWithProviderPreservesDots(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		// Mirrors what engine.runSignature emits after splitModel:
		// Model = bare, Provider = separate.
		Model:         "gemini-2.5-flash",
		Provider:      "gemini",
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := bodyField(t, gw.lastReq.Body, "model")
	if got != "gemini-2.5-flash" {
		t.Errorf("dots must be preserved for gemini; got %q", got)
	}
}

func TestExecute_AnthropicAliasExpansion(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:         "anthropic/claude-sonnet-4",
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := bodyField(t, gw.lastReq.Body, "model")
	if got != "claude-sonnet-4-20250514" {
		t.Errorf("expected anthropic alias expansion (bare), got %q", got)
	}
}

func TestExecute_CustomEmitsBareModelInBody(t *testing.T) {
	// Library pivot: body.model is the bare provider model id; the
	// custom→openai routing now happens via the credential's
	// ProviderID inside the dispatcher adapter, not by rewriting the
	// body. OpenAI-compatible custom endpoints (Together, Mistral,
	// Groq, …) accept bare model names natively.
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model: "custom/my-llm",
		LiteLLMParams: map[string]any{
			"api_key":  "k",
			"api_base": "https://api.together.xyz/v1",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	got := bodyField(t, gw.lastReq.Body, "model")
	if got != "my-llm" {
		t.Errorf("expected bare model on the wire, got %q", got)
	}
}

func TestExecute_ReasoningModelOverridesTempAndMaxTokens(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)

	temp := 0.2
	maxTok := 1000
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:         "openai/gpt-5-mini",
		Temperature:   &temp,
		MaxTokens:     &maxTok,
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	tempV := bodyFloat(t, gw.lastReq.Body, "temperature")
	if tempV != 1.0 {
		t.Errorf("expected reasoning model temperature pinned to 1.0, got %v", tempV)
	}
	// Reasoning models migrate max_tokens → max_completion_tokens
	// (OpenAI's reasoning API rejects max_tokens with HTTP 400).
	if hasField(t, gw.lastReq.Body, "max_tokens") {
		t.Errorf("max_tokens must be absent for reasoning models")
	}
	maxV := bodyFloat(t, gw.lastReq.Body, "max_completion_tokens")
	if maxV < 16000 {
		t.Errorf("expected reasoning model max_completion_tokens floored to 16000, got %v", maxV)
	}
}

// TestExecute_AnthropicReasoningEnabledFloorsMaxTokens pins the
// non-OpenAI half of langwatch_nlp regression ead6141a4. When the
// customer config sets a reasoning field on a non-reasoning-class
// model (e.g. an Anthropic Sonnet with thinkingLevel=high), the
// upstream provider may auto-enable extended thinking with budget_tokens
// that exceed a low max_tokens, producing a 400. The Go path must
// floor max_tokens at reasoningMaxTokensFloor (16000) for ANY model
// when reasoning is requested.
//
// This is the executor-level integration of EnsureReasoningMaxTokens
// (see translator_test.go for the unit-level pin).
func TestExecute_AnthropicReasoningEnabledFloorsMaxTokens(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)

	maxTok := 4096
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:           "anthropic/claude-sonnet-4",
		MaxTokens:       &maxTok,
		ReasoningEffort: "high",
		LiteLLMParams:   map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	// Anthropic doesn't get the OpenAI-reasoning rename, so max_tokens
	// stays as max_tokens (not max_completion_tokens) — but the floor
	// applies all the same.
	maxV := bodyFloat(t, gw.lastReq.Body, "max_tokens")
	if maxV < 16000 {
		t.Errorf("expected anthropic max_tokens floored to 16000 when reasoning enabled, got %v", maxV)
	}
}

// TestExecute_NonReasoningRequestPreservesLowMaxTokens guards the
// false-positive direction: a normal Anthropic request without any
// reasoning effort must keep its low max_tokens unchanged.
func TestExecute_NonReasoningRequestPreservesLowMaxTokens(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)

	maxTok := 256
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:         "anthropic/claude-sonnet-4",
		MaxTokens:     &maxTok,
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	maxV := bodyFloat(t, gw.lastReq.Body, "max_tokens")
	if maxV != 256 {
		t.Errorf("expected non-reasoning max_tokens preserved at 256, got %v", maxV)
	}
}

func TestExecute_AnthropicTemperatureClamped(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)

	temp := 1.5
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:         "anthropic/claude-3-5-sonnet-20240620",
		Temperature:   &temp,
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	tempV := bodyFloat(t, gw.lastReq.Body, "temperature")
	if tempV != 1.0 {
		t.Errorf("expected anthropic temperature clamped to 1, got %v", tempV)
	}
}

func TestExecute_InlineCredentialsHeaderSetForBedrock(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)

	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model: "bedrock/anthropic.claude-3-sonnet-20240229-v1:0",
		LiteLLMParams: map[string]any{
			"aws_access_key_id":     "AKIA",
			"aws_secret_access_key": "secret",
			"aws_region_name":       "us-east-1",
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	header := gw.lastReq.Headers[headerInlineCredentials]
	raw, _ := base64.StdEncoding.DecodeString(header)
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("inline-creds header malformed: %v", err)
	}
	if parsed["provider"] != "bedrock" {
		t.Errorf("expected provider bedrock in inline-creds, got %v", parsed["provider"])
	}
	bedrock, _ := parsed["bedrock"].(map[string]any)
	if bedrock["aws_access_key_id"] != "AKIA" {
		t.Errorf("expected aws_access_key_id in inline-creds, got %v", bedrock)
	}
}

func TestExecute_OriginHeaderFromContext(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)

	ctx := WithOrigin(context.Background(), "evaluation")
	_, err := exec.Execute(ctx, app.LLMRequest{
		Model:         "openai/gpt-5-mini",
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if gw.lastReq.Headers[headerOrigin] != "evaluation" {
		t.Errorf("expected origin header from context, got %q", gw.lastReq.Headers[headerOrigin])
	}
}

func TestExecute_NoOriginInContextLeavesHeaderAbsent(t *testing.T) {
	gw := &fakeGateway{respStatus: 200, respBody: successResponse("ok")}
	exec := New(gw)
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:         "openai/gpt-5-mini",
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, present := gw.lastReq.Headers[headerOrigin]; present {
		t.Errorf("expected origin header absent when context has none")
	}
}

func TestExecute_GatewayNon2xxReturnsTypedError(t *testing.T) {
	gw := &fakeGateway{
		respStatus: 401,
		respBody:   []byte(`{"type":"auth_failed"}`),
	}
	exec := New(gw)
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:         "openai/gpt-5-mini",
		LiteLLMParams: map[string]any{"api_key": "wrong"},
	})
	if err == nil {
		t.Fatalf("expected error on 401")
	}
	herr, ok := err.(*GatewayHTTPError)
	if !ok {
		t.Fatalf("expected *GatewayHTTPError, got %T", err)
	}
	if herr.StatusCode != 401 {
		t.Errorf("expected 401, got %d", herr.StatusCode)
	}
	if !strings.Contains(string(herr.Body), "auth_failed") {
		t.Errorf("expected error body forwarded, got %s", herr.Body)
	}
}

func TestExecute_StreamHeaderTrueWhenStreaming(t *testing.T) {
	// Smaller test: just verify buildGatewayRequest emits stream:true
	// for the streaming code path. (Stream end-to-end is covered in the
	// gatewayclient SSE tests.)
	req := app.LLMRequest{
		Model:         "openai/gpt-5-mini",
		LiteLLMParams: map[string]any{"api_key": "k"},
	}
	gwReq, err := buildGatewayRequest(context.Background(), req, true)
	if err != nil {
		t.Fatal(err)
	}
	if !bodyBool(t, gwReq.Body, "stream") {
		t.Errorf("expected stream:true in body for streaming call")
	}
}

func TestExecute_NoStreamFieldWhenNotStreaming(t *testing.T) {
	req := app.LLMRequest{
		Model:         "openai/gpt-5-mini",
		LiteLLMParams: map[string]any{"api_key": "k"},
	}
	gwReq, err := buildGatewayRequest(context.Background(), req, false)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	json.Unmarshal(gwReq.Body, &body)
	if _, present := body["stream"]; present {
		t.Errorf("expected stream key absent when not streaming")
	}
}

func TestExecute_ToolCallsForwardedAndResponseToolCallsParsed(t *testing.T) {
	respBody := []byte(`{
		"choices":[{
			"index":0,
			"message":{
				"role":"assistant",
				"content":null,
				"tool_calls":[
					{"id":"call_1","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"SF\"}"}}
				]
			},
			"finish_reason":"tool_calls"
		}],
		"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}
	}`)
	gw := &fakeGateway{respStatus: 200, respBody: respBody}
	exec := New(gw)

	resp, err := exec.Execute(context.Background(), app.LLMRequest{
		Model: "openai/gpt-5-mini",
		Tools: []app.Tool{
			{Type: "function", Function: map[string]any{"name": "get_weather"}},
		},
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(resp.ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call in response, got %d", len(resp.ToolCalls))
	}
	if resp.ToolCalls[0].ID != "call_1" {
		t.Errorf("expected call_1 id, got %q", resp.ToolCalls[0].ID)
	}
}

func TestExecute_RejectsModelWithoutProvider(t *testing.T) {
	gw := &fakeGateway{}
	exec := New(gw)
	_, err := exec.Execute(context.Background(), app.LLMRequest{
		Model:         "gpt-5-mini",
		LiteLLMParams: map[string]any{"api_key": "k"},
	})
	if err == nil {
		t.Fatalf("expected error for model without provider prefix")
	}
}

// --------------------------------------------------------------------------
// helpers
// --------------------------------------------------------------------------

func bodyField(t *testing.T, body []byte, key string) string {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	s, _ := m[key].(string)
	return s
}

func hasField(t *testing.T, body []byte, key string) bool {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	_, present := m[key]
	return present
}

func bodyFloat(t *testing.T, body []byte, key string) float64 {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	switch v := m[key].(type) {
	case float64:
		return v
	case int:
		return float64(v)
	default:
		t.Fatalf("expected numeric %s, got %T (%v)", key, v, v)
		return 0
	}
}

func bodyBool(t *testing.T, body []byte, key string) bool {
	t.Helper()
	var m map[string]any
	if err := json.Unmarshal(body, &m); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	b, _ := m[key].(bool)
	return b
}
