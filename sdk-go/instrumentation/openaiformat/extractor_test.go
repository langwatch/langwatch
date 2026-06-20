package openaiformat

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"github.com/langwatch/langwatch/sdk-go/instrumentation/otelhttp"
)

// selectRequest walks Extractors() in precedence order and returns the Name of
// the first extractor whose MatchesRequest accepts the body, mirroring the
// otelhttp base's shape dispatch (the generic fallback is last and always
// matches, so this never falls through).
func selectRequest(body otelhttp.JSONObject, pathHint string) string {
	for _, e := range Extractors() {
		if e.MatchesRequest(body, pathHint) {
			return e.Name()
		}
	}
	return ""
}

// selectResponse walks Extractors() in precedence order and returns the Name of
// the first extractor whose MatchesResponse accepts the response.
func selectResponse(objectField, contentType string) string {
	for _, e := range Extractors() {
		if e.MatchesResponse(objectField, contentType) {
			return e.Name()
		}
	}
	return ""
}

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
			body, _ := otelhttp.ParseBody([]byte(tt.body))
			assert.Equal(t, tt.want, selectRequest(body, tt.pathHint))
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
		{"text completion", "text_completion", "application/json", "chat"},
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
			assert.Equal(t, tt.want, selectResponse(tt.object, tt.contentType))
		})
	}
}

// TestResponsesStreamAccumulator exercises the typed Responses streaming
// reconstruction directly: output_text deltas accumulate and the terminal
// response.completed event provides usage, status and output text.
func TestResponsesStreamAccumulator(t *testing.T) {
	span, exporter := newSpan(t)

	acc := ResponsesExtractor{}.NewStreamAccumulator()
	assert.False(t, acc.IsTerminal("[DONE]"), "Responses stream has no [DONE] sentinel")

	acc.Consume(`{"type":"response.output_text.delta","delta":"Hello"}`)
	acc.Consume(`{"type":"response.output_text.delta","delta":" world"}`)
	acc.Consume(`{"type":"response.completed","response":{"id":"resp_acc","object":"response","model":"gpt-4o","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello world"}]}],"usage":{"input_tokens":8,"output_tokens":4,"total_tokens":12,"input_tokens_details":{"cached_tokens":2},"output_tokens_details":{"reasoning_tokens":1}}}}`)
	acc.Finish(span, langwatch.DataCaptureAll)
	span.End()

	attrs := requireSingleSpanAttrs(t, exporter)

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
	span, exporter := newSpan(t)

	acc := ResponsesExtractor{}.NewStreamAccumulator()
	acc.Consume(`{"type":"response.output_text.delta","delta":"part"}`)
	acc.Consume(`{"type":"error","code":"server_error","message":"upstream exploded"}`)
	acc.Finish(span, langwatch.DataCaptureAll)
	span.End()

	read := requireSingleSpan(t, exporter)
	assert.Equal(t, codes.Error, read.Status.Code)
	assert.Equal(t, "upstream exploded", read.Status.Description)
	attrs := attrsOf(read.Attributes)
	assert.Equal(t, attribute.StringValue("server_error"), attrs[attribute.Key("error.type")])
}

// TestResponsesStreamErrorEvent verifies the error event sets the span error
// status and type even with no preceding deltas.
func TestResponsesStreamErrorEvent(t *testing.T) {
	t.Run("an error event sets the span error status and type", func(t *testing.T) {
		span, exporter := newSpan(t)
		acc := ResponsesExtractor{}.NewStreamAccumulator()
		acc.Consume(`{"type":"error","code":"rate_limit_exceeded","message":"slow down"}`)
		acc.Finish(span, langwatch.DataCaptureAll)
		span.End()

		read := requireSingleSpan(t, exporter)
		assert.Equal(t, codes.Error, read.Status.Code)
		assert.Equal(t, "slow down", read.Status.Description)
		attrs := attrsOf(read.Attributes)
		assert.Equal(t, attribute.StringValue("rate_limit_exceeded"), attrs[attribute.Key("error.type")])
	})
}

// TestResponsesArrayInputRecorded verifies the array input is recorded (as JSON)
// when capture is enabled.
func TestResponsesArrayInputRecorded(t *testing.T) {
	raw := []byte(`{"model":"gpt-4o","input":[{"role":"user","content":"hello"},{"role":"user","content":"again"}]}`)
	attrs := recordExtractor(t, func(span *langwatch.Span) {
		streaming := ResponsesExtractor{}.ExtractRequest(span, raw, langwatch.DataCaptureAll)
		assert.False(t, streaming)
	})

	require.Contains(t, attrs, inputKey, "array input must be recorded")
	inputTV := parseTypedValue(t, attrs[inputKey].AsString())
	assert.Equal(t, "json", inputTV.Type, "array input is recorded as JSON, not dropped")
	assert.Contains(t, string(inputTV.Value), "hello")
	assert.Contains(t, string(inputTV.Value), "again")
}

// TestResponsesStringInputRecorded verifies a string input is recorded as a
// gen_ai user message and instructions become system instructions.
func TestResponsesStringInputRecorded(t *testing.T) {
	raw := []byte(`{"model":"gpt-4o","input":"Hello, OpenAI!","instructions":"You are a helpful assistant."}`)
	attrs := recordExtractor(t, func(span *langwatch.Span) {
		ResponsesExtractor{}.ExtractRequest(span, raw, langwatch.DataCaptureAll)
	})

	assert.Equal(t, attribute.StringValue("You are a helpful assistant."), attrs[genAISystemKey])
	inMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleUser, inMsgs[0].Role)
	assert.Equal(t, "Hello, OpenAI!", inMsgs[0].Content)
	// Chat input is not under langwatch.input.
	assert.NotContains(t, attrs, inputKey)
}

// TestResponsesToolChoiceGating verifies tool_choice is recorded only when set.
func TestResponsesToolChoiceGating(t *testing.T) {
	t.Run("absent when unset", func(t *testing.T) {
		raw := []byte(`{"model":"gpt-4o","input":"hi"}`)
		attrs := recordExtractor(t, func(span *langwatch.Span) {
			ResponsesExtractor{}.ExtractRequest(span, raw, langwatch.DataCaptureAll)
		})
		_, present := attrs[attribute.Key("gen_ai.request.tool_choice")]
		assert.False(t, present, "tool_choice must be absent when not set")
	})

	t.Run("recorded when set", func(t *testing.T) {
		raw := []byte(`{"model":"gpt-4o","input":"hi","tool_choice":"auto"}`)
		attrs := recordExtractor(t, func(span *langwatch.Span) {
			ResponsesExtractor{}.ExtractRequest(span, raw, langwatch.DataCaptureAll)
		})
		tc, present := attrs[attribute.Key("gen_ai.request.tool_choice")]
		require.True(t, present, "tool_choice must be recorded when set")
		assert.Contains(t, tc.AsString(), "auto")
	})
}

// TestResponsesFunctionCallOutput verifies a function_call output item becomes a
// tool_call rich-content part on the gen_ai output message.
func TestResponsesFunctionCallOutput(t *testing.T) {
	raw := []byte(`{"id":"resp_tool","object":"response","model":"gpt-4o","status":"completed","output":[{"type":"function_call","call_id":"fc_1","name":"search","arguments":"{\"term\":\"go\"}"}],"usage":{"input_tokens":9,"output_tokens":5,"total_tokens":14}}`)
	attrs := recordExtractor(t, func(span *langwatch.Span) {
		ResponsesExtractor{}.ExtractNonStreaming(span, raw, langwatch.DataCaptureAll)
	})

	require.Contains(t, attrs, genAIOutputKey)
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok, "content should be rich parts, got %T", msgs[0].Content)
	require.Len(t, parts, 1)
	toolPart := parts[0].(map[string]any)
	assert.Equal(t, "tool_call", toolPart["type"])
	assert.Equal(t, "search", toolPart["toolName"])
	assert.Equal(t, "fc_1", toolPart["toolCallId"])
	assert.JSONEq(t, `{"term":"go"}`, toolPart["args"].(string))
	assert.NotContains(t, attrs, outputKey)
}

// TestResponsesStreamDeltaFallback verifies that when the completed event
// carries no output text, the accumulated deltas are used.
func TestResponsesStreamDeltaFallback(t *testing.T) {
	span, exporter := newSpan(t)
	acc := ResponsesExtractor{}.NewStreamAccumulator()
	acc.Consume(`{"type":"response.output_text.delta","delta":"partial "}`)
	acc.Consume(`{"type":"response.output_text.delta","delta":"answer"}`)
	acc.Consume(`{"type":"response.completed","response":{"id":"resp_d","object":"response","model":"gpt-4o","status":"completed","output":[],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}`)
	acc.Finish(span, langwatch.DataCaptureAll)
	span.End()

	attrs := requireSingleSpanAttrs(t, exporter)
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, "partial answer", outMsgs[0].Content)
}

// TestGenericStreamAccumulator verifies the fallback stream reconstruction
// handles the chat-style delta shape and [DONE] sentinel.
func TestGenericStreamAccumulator(t *testing.T) {
	acc := GenericExtractor{}.NewStreamAccumulator()
	assert.True(t, acc.IsTerminal("[DONE]"))

	span, exporter := newSpan(t)
	acc.Consume(`{"id":"x","model":"m","choices":[{"delta":{"content":"a"}}]}`)
	acc.Consume(`{"choices":[{"delta":{"content":"b"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":2,"total_tokens":3}}`)
	acc.Finish(span, langwatch.DataCaptureAll)
	span.End()

	attrs := requireSingleSpanAttrs(t, exporter)
	assert.Equal(t, attribute.StringValue("x"), attrs[semconvGenAIResponseID])
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "ab", outMsgs[0].Content)
	assert.NotContains(t, attrs, outputKey)
}

func TestGenericExtractorRichBody(t *testing.T) {
	t.Run("it extracts id, model, usage, finish reasons, status and output", func(t *testing.T) {
		const body = `{"id":"gen-1","object":"unknown.thing","model":"some-model","system_fingerprint":"fp_x","usage":{"prompt_tokens":5,"completion_tokens":7,"total_tokens":12},"choices":[{"finish_reason":"stop"}],"status":"completed"}`

		attrs := recordExtractor(t, func(span *langwatch.Span) {
			GenericExtractor{}.ExtractNonStreaming(span, []byte(body), langwatch.DataCaptureAll)
		})

		assert.Equal(t, "gen-1", attrs[semconvGenAIResponseID].AsString())
		assert.Equal(t, "some-model", attrs[semconv.GenAIResponseModelKey].AsString())
		assert.Equal(t, int64(5), attrs[semconvGenAIUsageInputTokens].AsInt64())
		assert.Equal(t, int64(7), attrs[semconvGenAIUsageOutputTokens].AsInt64())
		assert.Equal(t, []string{"stop"}, attrs[semconv.GenAIResponseFinishReasonsKey].AsStringSlice())
		assert.Equal(t, "completed", attrs[attribute.Key("gen_ai.response.status")].AsString())
		_, hasOutput := attrs[outputKey]
		assert.True(t, hasOutput)
	})

	t.Run("with capture off it records usage but no output", func(t *testing.T) {
		const body = `{"object":"list","model":"m","usage":{"prompt_tokens":1,"total_tokens":1}}`
		attrs := recordExtractor(t, func(span *langwatch.Span) {
			GenericExtractor{}.ExtractNonStreaming(span, []byte(body), langwatch.DataCaptureNone)
		})
		assert.Equal(t, int64(1), attrs[semconvGenAIUsageInputTokens].AsInt64())
		_, hasOutput := attrs[outputKey]
		assert.False(t, hasOutput)
	})
}

func TestToChatMessagesFallback(t *testing.T) {
	t.Run("a non-message payload does not convert to chat messages", func(t *testing.T) {
		_, ok := otelhttp.ToChatMessages("not an array of messages")
		assert.False(t, ok)
	})

	t.Run("an empty array does not convert", func(t *testing.T) {
		_, ok := otelhttp.ToChatMessages([]any{})
		assert.False(t, ok)
	})
}

// TestOperationFromPath covers the gen_ai.operation.name mapping shared by both
// OpenAI-format instrumentations.
func TestOperationFromPath(t *testing.T) {
	tests := []struct {
		path string
		want string
	}{
		{"/v1/chat/completions", "chat"},
		{"/v1/completions", "text_completion"},
		{"/v1/embeddings", "embeddings"},
		{"/v1/responses", "responses"},
		{"/v1/audio/speech", "audio"},
		{"/v1/images/generations", "images"},
		{"/openai/deployments/gpt-4/chat/completions", "chat"},
		{"/openai/deployments/gpt-4/responses", "responses"},
		{"/v1/unknown", "unknown"},
		{"/some/random/path", "chat"},
		{"", "chat"},
	}
	for _, tt := range tests {
		t.Run(tt.path, func(t *testing.T) {
			got := GenAIOperationFromPath(tt.path)
			assert.Equal(t, tt.want, got.Value.AsString())
		})
	}
}

// helper assertions

func requireSingleSpanAttrs(t *testing.T, exporter *tracetest.InMemoryExporter) map[attribute.Key]attribute.Value {
	t.Helper()
	return attrsOf(requireSingleSpan(t, exporter).Attributes)
}

func requireSingleSpan(t *testing.T, exporter *tracetest.InMemoryExporter) tracetest.SpanStub {
	t.Helper()
	spans := exporter.GetSpans()
	require.Len(t, spans, 1, "expected exactly one exported span")
	return spans[0]
}
