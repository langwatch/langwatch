package dispatch

import (
	"context"
	"encoding/json"
	"testing"

	bfschemas "github.com/maximhq/bifrost/core/schemas"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"

	gwotel "github.com/langwatch/langwatch/services/gateway/internal/otel"
)

// spanAttrs returns the ended span's attributes as a map keyed by
// attribute name. Convenience for assert-per-attribute flow.
func spanAttrs(t *testing.T, fn func(ctx context.Context)) map[string]attribute.Value {
	t.Helper()
	rec := tracetest.NewSpanRecorder()
	tp := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(rec))
	tr := tp.Tracer("test")
	otel.SetTracerProvider(tp)

	ctx, span := tr.Start(context.Background(), "lw_gateway.chat_completions")
	fn(ctx)
	span.End()

	spans := rec.Ended()
	if len(spans) != 1 {
		t.Fatalf("want 1 span, got %d", len(spans))
	}
	out := map[string]attribute.Value{}
	for _, kv := range spans[0].Attributes() {
		out[string(kv.Key)] = kv.Value
	}
	return out
}

func TestStampGenAIRequestParams_AllFields(t *testing.T) {
	temp := 0.42
	topP := 0.9
	freq := 0.1
	pres := -0.1
	maxToks := int64(256)
	parsed := openaiChatRequest{
		Model:           "gpt-5-mini",
		Stream:          false,
		Temperature:     &temp,
		TopP:            &topP,
		FrequencyPenalty: &freq,
		PresencePenalty: &pres,
		MaxTokens:       &maxToks,
		Stop:            json.RawMessage(`["<|im_end|>","</s>"]`),
	}
	attrs := spanAttrs(t, func(ctx context.Context) {
		stampGenAIRequestParams(ctx, parsed)
	})

	required := []string{
		gwotel.AttrGenAIRequestTemperature,
		gwotel.AttrGenAIRequestTopP,
		gwotel.AttrGenAIRequestFreqPenalty,
		gwotel.AttrGenAIRequestPresPenalty,
		gwotel.AttrGenAIRequestMaxTokens,
		gwotel.AttrGenAIRequestStopSeqs,
	}
	for _, key := range required {
		if _, ok := attrs[key]; !ok {
			t.Errorf("attr %s missing", key)
		}
	}
	if attrs[gwotel.AttrGenAIRequestTemperature].AsFloat64() != temp {
		t.Errorf("temperature: want %v, got %v", temp, attrs[gwotel.AttrGenAIRequestTemperature].AsFloat64())
	}
	if attrs[gwotel.AttrGenAIRequestMaxTokens].AsInt64() != maxToks {
		t.Errorf("max_tokens: want %v, got %v", maxToks, attrs[gwotel.AttrGenAIRequestMaxTokens].AsInt64())
	}
	if attrs[gwotel.AttrGenAIRequestStopSeqs].AsString() != `["<|im_end|>","</s>"]` {
		t.Errorf("stop: want JSON array, got %q", attrs[gwotel.AttrGenAIRequestStopSeqs].AsString())
	}
}

func TestStampGenAIRequestParams_Omits_UnsetFields(t *testing.T) {
	parsed := openaiChatRequest{Model: "gpt-5-mini"}
	attrs := spanAttrs(t, func(ctx context.Context) {
		stampGenAIRequestParams(ctx, parsed)
	})
	for _, key := range []string{
		gwotel.AttrGenAIRequestTemperature,
		gwotel.AttrGenAIRequestTopP,
		gwotel.AttrGenAIRequestMaxTokens,
		gwotel.AttrGenAIRequestStopSeqs,
	} {
		if _, ok := attrs[key]; ok {
			t.Errorf("unset field %s should not be stamped, got %v", key, attrs[key])
		}
	}
}

func TestStampGenAIRequestParams_PrefersMaxCompletionTokens(t *testing.T) {
	mt := int64(100)
	mct := int64(250)
	parsed := openaiChatRequest{Model: "gpt-5-mini", MaxTokens: &mt, MaxCompletion: &mct}
	attrs := spanAttrs(t, func(ctx context.Context) {
		stampGenAIRequestParams(ctx, parsed)
	})
	if attrs[gwotel.AttrGenAIRequestMaxTokens].AsInt64() != mct {
		t.Errorf("want max_completion_tokens (%d) to win, got %d", mct, attrs[gwotel.AttrGenAIRequestMaxTokens].AsInt64())
	}
}

func TestStampGenAIResponseMeta_AllFields(t *testing.T) {
	stop := "stop"
	length := "length"
	resp := &bfschemas.BifrostChatResponse{
		ID:    "chatcmpl-abc123",
		Model: "gpt-5-mini-2025-08-07",
		Choices: []bfschemas.BifrostResponseChoice{
			{FinishReason: &stop},
			{FinishReason: &length},
		},
	}
	attrs := spanAttrs(t, func(ctx context.Context) {
		stampGenAIResponseMeta(ctx, resp)
	})
	if attrs[gwotel.AttrGenAIResponseID].AsString() != "chatcmpl-abc123" {
		t.Errorf("response id mismatch: %v", attrs[gwotel.AttrGenAIResponseID])
	}
	if attrs[gwotel.AttrGenAIResponseModel].AsString() != "gpt-5-mini-2025-08-07" {
		t.Errorf("response model mismatch: %v", attrs[gwotel.AttrGenAIResponseModel])
	}
	if attrs[gwotel.AttrGenAIResponseFinishReasons].AsString() != `["stop","length"]` {
		t.Errorf("finish_reasons mismatch: got %q", attrs[gwotel.AttrGenAIResponseFinishReasons].AsString())
	}
}

func TestStampGenAIResponseMeta_NilResponse(t *testing.T) {
	attrs := spanAttrs(t, func(ctx context.Context) {
		stampGenAIResponseMeta(ctx, nil)
	})
	for _, k := range []string{gwotel.AttrGenAIResponseID, gwotel.AttrGenAIResponseModel, gwotel.AttrGenAIResponseFinishReasons} {
		if _, ok := attrs[k]; ok {
			t.Errorf("nil response should not stamp %s", k)
		}
	}
}

func TestResolveSystemInstructions_PrefersAnthropicTopLevel(t *testing.T) {
	parsed := openaiChatRequest{
		System:   json.RawMessage(`"You are a terse assistant."`),
		Messages: json.RawMessage(`[{"role":"system","content":"ignored"},{"role":"user","content":"hi"}]`),
	}
	got := resolveSystemInstructions(parsed)
	if got != `"You are a terse assistant."` {
		t.Errorf("Anthropic system should win, got %q", got)
	}
}

func TestResolveSystemInstructions_HoistsFromOpenAIMessages(t *testing.T) {
	parsed := openaiChatRequest{
		Messages: json.RawMessage(`[{"role":"system","content":"You are a terse assistant."},{"role":"user","content":"hi"}]`),
	}
	got := resolveSystemInstructions(parsed)
	if got == "" {
		t.Fatal("expected hoisted system instructions")
	}
	var arr []map[string]any
	if err := json.Unmarshal([]byte(got), &arr); err != nil {
		t.Fatalf("not valid JSON: %v", err)
	}
	if len(arr) != 1 || arr[0]["role"] != "system" {
		t.Errorf("unexpected shape: %v", arr)
	}
	if arr[0]["content"] != "You are a terse assistant." {
		t.Errorf("content mismatch: %v", arr[0]["content"])
	}
}

func TestResolveSystemInstructions_EmptyWhenNoSystem(t *testing.T) {
	parsed := openaiChatRequest{
		Messages: json.RawMessage(`[{"role":"user","content":"hi"}]`),
	}
	if got := resolveSystemInstructions(parsed); got != "" {
		t.Errorf("expected empty, got %q", got)
	}
}

func TestExtractOutputMessages_ShapeMatchesCanonicaliser(t *testing.T) {
	content := "hello there"
	role := bfschemas.ChatMessageRoleAssistant
	stop := "stop"
	resp := &bfschemas.BifrostChatResponse{
		Choices: []bfschemas.BifrostResponseChoice{
			{
				FinishReason: &stop,
				ChatNonStreamResponseChoice: &bfschemas.ChatNonStreamResponseChoice{
					Message: &bfschemas.ChatMessage{
						Role: role,
						Content: &bfschemas.ChatMessageContent{
							ContentStr: &content,
						},
					},
				},
			},
		},
	}
	got := extractOutputMessages(resp)
	if got == "" {
		t.Fatal("want non-empty output messages")
	}
	var parsed []map[string]any
	if err := json.Unmarshal([]byte(got), &parsed); err != nil {
		t.Fatalf("output not valid JSON: %v", err)
	}
	if len(parsed) != 1 {
		t.Fatalf("want 1 message, got %d", len(parsed))
	}
	if parsed[0]["role"] != string(role) {
		t.Errorf("role mismatch: %v", parsed[0]["role"])
	}
	if parsed[0]["content"] != content {
		t.Errorf("content mismatch: %v", parsed[0]["content"])
	}
	if parsed[0]["finish_reason"] != "stop" {
		t.Errorf("finish_reason mismatch: %v", parsed[0]["finish_reason"])
	}
}
