package openaiformat

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// TestChatExtractor_Request records params + input messages, and reports the
// stream flag.
func TestChatExtractor_Request(t *testing.T) {
	raw := []byte(`{"model":"gpt-4o-mini","messages":[{"role":"user","content":"ping"}],"max_completion_tokens":5,"temperature":0.7,"top_p":0.9}`)
	attrs := recordExtractor(t, func(span *langwatch.Span) {
		// ExtractRequest returns the stream flag (false here); the canonical
		// gen_ai.request.stream attribute is recorded by the otelhttp base, not
		// the extractor, so the streaming contract is asserted on the return value.
		streaming := ChatExtractor{}.ExtractRequest(span, raw, langwatch.DataCaptureAll)
		assert.False(t, streaming)
	})

	assert.Equal(t, attribute.StringValue("gpt-4o-mini"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.Float64Value(0.7), attrs[semconv.GenAIRequestTemperatureKey])
	assert.Equal(t, attribute.Float64Value(0.9), attrs[semconv.GenAIRequestTopPKey])
	assert.Equal(t, attribute.IntValue(5), attrs[semconv.GenAIRequestMaxTokensKey])

	inMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleUser, inMsgs[0].Role)
	assert.Equal(t, "ping", inMsgs[0].Content)
	assert.NotContains(t, attrs, inputKey)
}

// TestChatExtractor_Response records identity, usage (incl. cached/reasoning) as
// gen_ai.usage.* attributes, finish reasons and gen_ai output.
func TestChatExtractor_Response(t *testing.T) {
	raw := []byte(`{"id":"cmpl-xyz","object":"chat.completion","model":"gpt-test-resp","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3,"prompt_tokens_details":{"cached_tokens":1},"completion_tokens_details":{"reasoning_tokens":4}},"system_fingerprint":"fp_test_value"}`)
	attrs := recordExtractor(t, func(span *langwatch.Span) {
		ChatExtractor{}.ExtractNonStreaming(span, raw, langwatch.DataCaptureAll)
	})

	assert.Equal(t, attribute.StringValue("cmpl-xyz"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("gpt-test-resp"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("fp_test_value"), attrs[semconv.OpenAIResponseSystemFingerprintKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(3), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(1), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	assert.Equal(t, attribute.IntValue(4), attrs[attribute.Key("gen_ai.usage.reasoning.output_tokens")])

	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "pong", outMsgs[0].Content)
	assert.NotContains(t, attrs, outputKey)
}

// TestChatExtractor_ToolCalls records a tool-calling response as a structured
// assistant message carrying the tool call.
func TestChatExtractor_ToolCalls(t *testing.T) {
	raw := []byte(`{"id":"cmpl-tool","object":"chat.completion","model":"gpt-4o-mini","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_time","arguments":"{\"tz\":\"UTC\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":6,"total_tokens":10}}`)
	attrs := recordExtractor(t, func(span *langwatch.Span) {
		ChatExtractor{}.ExtractNonStreaming(span, raw, langwatch.DataCaptureAll)
	})

	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	require.Len(t, msgs[0].ToolCalls, 1, "the tool call must be captured, not dropped")
	tc := msgs[0].ToolCalls[0]
	assert.Equal(t, "call_1", tc.ID)
	assert.Equal(t, "function", tc.Type)
	assert.Equal(t, "get_time", tc.Function.Name)
	assert.JSONEq(t, `{"tz":"UTC"}`, tc.Function.Arguments)
	assert.NotContains(t, attrs, outputKey)
}

// TestChatExtractor_LegacyCompletion records a legacy /completions answer as
// arbitrary output text (not a chat message), and the prompt as input text.
func TestChatExtractor_LegacyCompletion(t *testing.T) {
	reqRaw := []byte(`{"model":"gpt-3.5-turbo-instruct","prompt":"Q: 2+2? A:","max_tokens":8,"temperature":0.5}`)
	respRaw := []byte(`{"id":"cmpl-leg","object":"text_completion","model":"gpt-3.5-turbo-instruct","choices":[{"index":0,"text":"  the answer","finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`)

	attrs := recordExtractor(t, func(span *langwatch.Span) {
		ChatExtractor{}.ExtractRequest(span, reqRaw, langwatch.DataCaptureAll)
		ChatExtractor{}.ExtractNonStreaming(span, respRaw, langwatch.DataCaptureAll)
	})

	// The prompt is recorded under langwatch.input (non-chat), not gen_ai.input.messages.
	require.Contains(t, attrs, inputKey)
	inputTV := parseTypedValue(t, attrs[inputKey].AsString())
	assert.Equal(t, "text", inputTV.Type)
	assert.JSONEq(t, `"Q: 2+2? A:"`, string(inputTV.Value))
	assert.NotContains(t, attrs, genAIInputKey)

	// The answer is recorded under langwatch.output (non-chat), not gen_ai.output.messages.
	outputTV := parseTypedValue(t, attrs[outputKey].AsString())
	assert.Equal(t, "text", outputTV.Type)
	assert.JSONEq(t, `"  the answer"`, string(outputTV.Value))
	assert.NotContains(t, attrs, genAIOutputKey)
	assert.Equal(t, attribute.StringSliceValue([]string{"length"}), attrs[semconv.GenAIResponseFinishReasonsKey])
}

// TestChatStreamAccumulator reconstructs a chat stream incl. usage and tool calls.
func TestChatStreamAccumulator(t *testing.T) {
	span, exporter := newSpan(t)
	acc := ChatExtractor{}.NewStreamAccumulator()
	assert.True(t, acc.IsTerminal("[DONE]"))

	acc.Consume(`{"id":"cmpl-str","object":"chat.completion.chunk","model":"gpt-stream-resp","system_fingerprint":"fp_stream_test","choices":[{"index":0,"delta":{"role":"assistant","content":"one"},"finish_reason":null}]}`)
	acc.Consume(`{"id":"cmpl-str","object":"chat.completion.chunk","model":"gpt-stream-resp","choices":[{"index":0,"delta":{"content":" two"},"finish_reason":"stop"}]}`)
	acc.Consume(`{"id":"cmpl-str","object":"chat.completion.chunk","model":"gpt-stream-resp","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6,"prompt_tokens_details":{"cached_tokens":3}}}`)
	acc.Finish(span, langwatch.DataCaptureAll)
	span.End()

	attrs := requireSingleSpanAttrs(t, exporter)
	assert.Equal(t, attribute.StringValue("cmpl-str"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("gpt-stream-resp"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("fp_stream_test"), attrs[semconv.OpenAIResponseSystemFingerprintKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])
	assert.Equal(t, attribute.IntValue(4), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(6), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(3), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])

	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, "one two", outMsgs[0].Content)
	assert.NotContains(t, attrs, outputKey)
}

// TestChatStreamAccumulator_ToolCalls reassembles a streamed tool call whose
// arguments arrive incrementally.
func TestChatStreamAccumulator_ToolCalls(t *testing.T) {
	span, exporter := newSpan(t)
	acc := ChatExtractor{}.NewStreamAccumulator()
	acc.Consume(`{"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_s","type":"function","function":{"name":"add","arguments":""}}]},"finish_reason":null}]}`)
	acc.Consume(`{"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"a\":1,"}}]},"finish_reason":null}]}`)
	acc.Consume(`{"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"b\":2}"}}]},"finish_reason":"tool_calls"}]}`)
	acc.Finish(span, langwatch.DataCaptureAll)
	span.End()

	attrs := requireSingleSpanAttrs(t, exporter)
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	require.Len(t, msgs[0].ToolCalls, 1, "streamed tool call must be reassembled")
	tc := msgs[0].ToolCalls[0]
	assert.Equal(t, "call_s", tc.ID)
	assert.Equal(t, "add", tc.Function.Name)
	assert.JSONEq(t, `{"a":1,"b":2}`, tc.Function.Arguments)
}

// TestEmbeddingsExtractor records dimensions, encoding format, usage and the
// vector count (not the vectors).
func TestEmbeddingsExtractor(t *testing.T) {
	reqRaw := []byte(`{"model":"text-embedding-3-small","input":"embed me","encoding_format":"float","dimensions":256}`)
	respRaw := []byte(`{"object":"list","model":"text-embedding-3-small","data":[{"object":"embedding","index":0,"embedding":[0.1,0.2,0.3]}],"usage":{"prompt_tokens":6,"total_tokens":6}}`)

	attrs := recordExtractor(t, func(span *langwatch.Span) {
		streaming := EmbeddingsExtractor{}.ExtractRequest(span, reqRaw, langwatch.DataCaptureAll)
		assert.False(t, streaming, "embeddings never stream")
		EmbeddingsExtractor{}.ExtractNonStreaming(span, respRaw, langwatch.DataCaptureAll)
	})

	assert.Equal(t, attribute.StringValue("text-embedding-3-small"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.StringValue("text-embedding-3-small"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.IntValue(6), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(6), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.NotContains(t, attrs, semconv.GenAIUsageOutputTokensKey, "embeddings have no completion tokens")
	assert.Equal(t, attribute.IntValue(256), attrs[semconv.GenAIEmbeddingsDimensionCountKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"float"}), attrs[semconv.GenAIRequestEncodingFormatsKey])

	inputTV := parseTypedValue(t, attrs[inputKey].AsString())
	assert.Equal(t, "text", inputTV.Type)
	assert.Equal(t, attribute.IntValue(1), attrs[attribute.Key("gen_ai.response.embeddings_count")])
}

// TestDataCaptureGating verifies content keys are gated by capture mode while
// usage is always recorded.
func TestDataCaptureGating(t *testing.T) {
	reqRaw := []byte(`{"model":"gpt-test","messages":[{"role":"user","content":"ping"}]}`)
	respRaw := []byte(`{"id":"cmpl-xyz","object":"chat.completion","model":"gpt-test","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`)

	cases := []struct {
		name         string
		mode         langwatch.DataCaptureMode
		expectInput  bool
		expectOutput bool
	}{
		{"All", langwatch.DataCaptureAll, true, true},
		{"Input only", langwatch.DataCaptureInput, true, false},
		{"Output only", langwatch.DataCaptureOutput, false, true},
		{"None", langwatch.DataCaptureNone, false, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			attrs := recordExtractor(t, func(span *langwatch.Span) {
				ChatExtractor{}.ExtractRequest(span, reqRaw, tc.mode)
				ChatExtractor{}.ExtractNonStreaming(span, respRaw, tc.mode)
			})

			_, hasInput := attrs[genAIInputKey]
			_, hasOutput := attrs[genAIOutputKey]
			assert.Equal(t, tc.expectInput, hasInput, "input capture")
			assert.Equal(t, tc.expectOutput, hasOutput, "output capture")
			assert.NotContains(t, attrs, inputKey)
			assert.NotContains(t, attrs, outputKey)

			// Usage is always recorded (gen_ai.usage.*), regardless of capture mode.
			assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageInputTokensKey])
		})
	}
}
