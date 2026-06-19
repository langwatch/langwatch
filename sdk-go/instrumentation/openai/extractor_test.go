package openai

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

func TestSelectRequestExtractor(t *testing.T) {
	tests := []struct {
		name     string
		body     string
		pathHint string
		want     string
	}{
		{
			name: "chat by messages",
			body: `{"model":"gpt-4o","messages":[{"role":"user","content":"hi"}]}`,
			want: "chat",
		},
		{
			name:     "chat by path even without messages",
			body:     `{"model":"gpt-4o"}`,
			pathHint: "/v1/chat/completions",
			want:     "chat",
		},
		{
			name: "responses by input + instructions",
			body: `{"model":"gpt-4o","input":"hi","instructions":"be nice"}`,
			want: "responses",
		},
		{
			name: "responses by input + max_output_tokens",
			body: `{"model":"gpt-4o","input":"hi","max_output_tokens":50}`,
			want: "responses",
		},
		{
			name:     "responses by path",
			body:     `{"model":"gpt-4o","input":"hi"}`,
			pathHint: "/v1/responses",
			want:     "responses",
		},
		{
			name: "embeddings by input + encoding_format",
			body: `{"model":"text-embedding-3-small","input":"hi","encoding_format":"float"}`,
			want: "embeddings",
		},
		{
			name: "embeddings by input + dimensions",
			body: `{"model":"text-embedding-3-small","input":"hi","dimensions":256}`,
			want: "embeddings",
		},
		{
			name:     "embeddings by path",
			body:     `{"model":"text-embedding-3-small","input":"hi"}`,
			pathHint: "/v1/embeddings",
			want:     "embeddings",
		},
		{
			name: "fallback for unknown moderation payload",
			body: `{"model":"text-moderation-007","input":"hi"}`,
			want: "openai",
		},
		{
			name: "fallback for empty body",
			body: `{}`,
			want: "openai",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			body, _ := parseBody([]byte(tt.body))
			got := selectRequestExtractor(body, tt.pathHint)
			assert.Equal(t, tt.want, got.name())
		})
	}
}

func TestSelectResponseExtractor(t *testing.T) {
	tests := []struct {
		name        string
		object      string
		contentType string
		want        string
	}{
		{"chat completion", "chat.completion", "application/json", "chat"},
		{"response", "response", "application/json", "responses"},
		{"embeddings list", "list", "application/json", "embeddings"},
		{"unknown object", "moderation", "application/json", "openai"},
		{"no object", "", "application/json", "openai"},
		// SSE responses are never claimed by the typed extractors here; the
		// streaming path is decided from the request shape, so the generic
		// fallback owns the content-type-based selection.
		{"event stream", "", "text/event-stream", "openai"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := selectResponseExtractor(tt.object, tt.contentType)
			assert.Equal(t, tt.want, got.name())
		})
	}
}

// TestResponsesStreamAccumulator exercises the typed Responses streaming
// reconstruction directly: output_text deltas accumulate and the terminal
// response.completed event provides usage, status and output text.
func TestResponsesStreamAccumulator(t *testing.T) {
	provider, exporter := newTestProvider(t)
	tracer := langwatch.TracerFromProvider(provider, "test")
	_, span := tracer.Start(t.Context(), "responses-stream")

	acc := (responsesExtractor{}).newStreamAccumulator()
	assert.False(t, acc.isTerminal("[DONE]"), "Responses stream has no [DONE] sentinel")

	acc.consume(`{"type":"response.output_text.delta","delta":"Hello"}`)
	acc.consume(`{"type":"response.output_text.delta","delta":" world"}`)
	acc.consume(`{"type":"response.completed","response":{"id":"resp_acc","object":"response","model":"gpt-4o","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello world"}]}],"usage":{"input_tokens":8,"output_tokens":4,"total_tokens":12,"input_tokens_details":{"cached_tokens":2},"output_tokens_details":{"reasoning_tokens":1}}}}`)
	acc.finish(span, langwatch.DataCaptureAll)
	span.End()

	read := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(read)

	assert.Equal(t, attribute.StringValue("resp_acc"), attrs[semconvGenAIResponseID])
	assert.Equal(t, attribute.IntValue(8), attrs[semconvGenAIUsageInputTokens])
	assert.Equal(t, attribute.IntValue(4), attrs[semconvGenAIUsageOutputTokens])
	assert.Equal(t, attribute.IntValue(2), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	assert.Equal(t, attribute.IntValue(1), attrs[attribute.Key("gen_ai.usage.reasoning.output_tokens")])
	assert.Equal(t, attribute.StringValue("completed"), attrs[attribute.Key("gen_ai.response.status")])

	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "Hello world", outMsgs[0].Content)
	assert.NotContains(t, attrs, outputKey)
}

// TestResponsesStreamAccumulator_ErrorEvent verifies a top-level error event
// marks the span as errored.
func TestResponsesStreamAccumulator_ErrorEvent(t *testing.T) {
	provider, exporter := newTestProvider(t)
	tracer := langwatch.TracerFromProvider(provider, "test")
	_, span := tracer.Start(t.Context(), "responses-error")

	acc := (responsesExtractor{}).newStreamAccumulator()
	acc.consume(`{"type":"response.output_text.delta","delta":"part"}`)
	acc.consume(`{"type":"error","code":"server_error","message":"upstream exploded"}`)
	acc.finish(span, langwatch.DataCaptureAll)
	span.End()

	read := requireSingleSpan(t, provider, exporter)
	assert.Equal(t, codes.Error, read.Status().Code)
	assert.Equal(t, "upstream exploded", read.Status().Description)
	attrs := spanAttrs(read)
	assert.Equal(t, attribute.StringValue("server_error"), attrs[attribute.Key("error.type")])
}

// TestResponsesArrayInputRecorded verifies the previously-dropped array input is
// recorded (as JSON) when capture is enabled.
func TestResponsesArrayInputRecorded(t *testing.T) {
	provider, exporter := newTestProvider(t)
	tracer := langwatch.TracerFromProvider(provider, "test")
	_, span := tracer.Start(t.Context(), "responses-array-input")

	raw := []byte(`{"model":"gpt-4o","input":[{"role":"user","content":"hello"},{"role":"user","content":"again"}]}`)
	streaming := (responsesExtractor{}).extractRequest(span, raw, langwatch.DataCaptureAll)
	span.End()
	assert.False(t, streaming)

	read := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(read)
	require.Contains(t, attrs, inputKey, "array input must be recorded")
	inputTV := parseTypedValue(t, attrs[inputKey].AsString())
	assert.Equal(t, "json", inputTV.Type, "array input is recorded as JSON, not dropped")
	assert.Contains(t, string(inputTV.Value), "hello")
	assert.Contains(t, string(inputTV.Value), "again")
}

// TestGenericStreamAccumulator verifies the fallback stream reconstruction
// handles the chat-style delta shape and [DONE] sentinel.
func TestGenericStreamAccumulator(t *testing.T) {
	acc := (genericExtractor{}).newStreamAccumulator()
	assert.True(t, acc.isTerminal("[DONE]"))

	provider, exporter := newTestProvider(t)
	tracer := langwatch.TracerFromProvider(provider, "test")
	_, span := tracer.Start(t.Context(), "generic-stream")

	acc.consume(`{"id":"x","model":"m","choices":[{"delta":{"content":"a"}}]}`)
	acc.consume(`{"choices":[{"delta":{"content":"b"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`)
	acc.finish(span, langwatch.DataCaptureAll)
	span.End()

	read := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(read)
	assert.Equal(t, attribute.StringValue("x"), attrs[semconvGenAIResponseID])
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "ab", outMsgs[0].Content)
	assert.NotContains(t, attrs, outputKey)
}
