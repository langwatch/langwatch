package anthropic

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/option"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// cacheCreationKey is the gen_ai.usage.cache_creation.input_tokens attribute
// emitted via SetGenAIUsage (the sole token source) and read by the server
// canonicalisation.
var cacheCreationKey = attribute.Key("gen_ai.usage.cache_creation.input_tokens")

func TestMiddleware_Messages_NonStreaming(t *testing.T) {
	const respBody = `{"id":"msg_01XYZ","type":"message","role":"assistant","model":"claude-haiku-4-5-resp","content":[{"type":"text","text":"Hello, world!"}],"stop_reason":"end_turn","stop_sequence":null,"usage":{"input_tokens":12,"output_tokens":7,"cache_read_input_tokens":4,"cache_creation_input_tokens":5}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := anthropic.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware(WithTracerProvider(provider))),
	)

	_, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeHaiku4_5,
		MaxTokens: 1024,
		System:    []anthropic.TextBlockParam{{Text: "You are a helpful assistant."}},
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Say hello")),
		},
		Temperature:   anthropic.Float(0.7),
		TopP:          anthropic.Float(0.9),
		TopK:          anthropic.Int(40),
		StopSequences: []string{"STOP"},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Span identity + operation.
	assert.Equal(t, "messages."+string(anthropic.ModelClaudeHaiku4_5), span.Name())
	assert.Equal(t, codes.Ok, span.Status().Code)
	assert.Equal(t, attribute.StringValue("anthropic"), attrs[semconv.GenAIProviderNameKey])
	assert.Equal(t, attribute.StringValue("chat"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("llm"), attrs[langwatch.AttributeLangWatchSpanType])

	// Request params.
	assert.Equal(t, attribute.StringValue(string(anthropic.ModelClaudeHaiku4_5)), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.IntValue(1024), attrs[semconv.GenAIRequestMaxTokensKey])
	assert.Equal(t, attribute.Float64Value(0.7), attrs[semconv.GenAIRequestTemperatureKey])
	assert.Equal(t, attribute.Float64Value(0.9), attrs[semconv.GenAIRequestTopPKey])
	assert.Equal(t, attribute.Float64Value(40), attrs[semconv.GenAIRequestTopKKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"STOP"}), attrs[semconv.GenAIRequestStopSequencesKey])
	// A non-streaming request records gen_ai.request.stream == false (the canonical
	// streaming flag, recorded by the otelhttp base) and no TTFT.
	assert.Equal(t, attribute.BoolValue(false), attrs[attribute.Key("gen_ai.request.stream")])
	assert.NotContains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"))

	// System prompt -> gen_ai.system_instructions (plain string, NOT langwatch.input).
	assert.Equal(t, "You are a helpful assistant.", attrs[genAISystemKey].AsString())
	assert.NotContains(t, attrs, inputKey, "chat I/O must not be on langwatch.input")

	// Response identity + finish reason + model.
	assert.Equal(t, attribute.StringValue("msg_01XYZ"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("claude-haiku-4-5-resp"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"end_turn"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// Usage is emitted solely via gen_ai.usage.* attributes (the langwatch.metrics
	// blob no longer carries token fields).
	assert.Equal(t, attribute.IntValue(12), attrs[attribute.Key("gen_ai.usage.input_tokens")])
	assert.Equal(t, attribute.IntValue(7), attrs[attribute.Key("gen_ai.usage.output_tokens")])
	// total = input + output + cache_read + cache_creation (cache tokens are real
	// input tokens; excluding them understates usage): 12 + 7 + 4 + 5 = 28.
	assert.Equal(t, attribute.IntValue(28), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(4), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	// Cache-creation tokens flow through SetGenAIUsage (gen_ai.usage.cache_creation.input_tokens).
	assert.Equal(t, attribute.IntValue(5), attrs[cacheCreationKey])

	// Input recorded as gen_ai.input.messages (raw JSON array), the user turn.
	// Anthropic wraps content in text blocks, so Content round-trips as rich parts.
	require.Contains(t, attrs, genAIInputKey, "chat input must be on gen_ai.input.messages")
	inMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleUser, inMsgs[0].Role)
	inParts, ok := inMsgs[0].Content.([]any)
	require.True(t, ok, "user content should be rich parts, got %T", inMsgs[0].Content)
	require.Len(t, inParts, 1)
	assert.Equal(t, "Say hello", inParts[0].(map[string]any)["text"])

	// Output recorded as gen_ai.output.messages (raw JSON array), an assistant
	// text message — NOT langwatch.output.
	require.Contains(t, attrs, genAIOutputKey, "chat output must be on gen_ai.output.messages")
	assert.NotContains(t, attrs, outputKey, "chat output must not be on langwatch.output")
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "Hello, world!", outMsgs[0].Content)
}

func TestMiddleware_Messages_Tools(t *testing.T) {
	const respBody = `{"id":"msg_tool","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[{"type":"tool_use","id":"toolu_1","name":"get_weather","input":{"city":"SF"}}],"stop_reason":"tool_use","usage":{"input_tokens":20,"output_tokens":15}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := anthropic.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware(WithTracerProvider(provider))),
	)

	_, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeHaiku4_5,
		MaxTokens: 512,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Weather in SF?")),
		},
		Tools: []anthropic.ToolUnionParam{
			{OfTool: &anthropic.ToolParam{
				Name:        "get_weather",
				Description: anthropic.String("Get the weather for a city"),
				InputSchema: anthropic.ToolInputSchemaParam{
					Properties: map[string]any{
						"city": map[string]any{"type": "string"},
					},
				},
			}},
		},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Tool definitions recorded as gen_ai.request.tools (JSON string).
	require.Contains(t, attrs, attribute.Key("gen_ai.request.tools"))
	assert.Contains(t, attrs[attribute.Key("gen_ai.request.tools")].AsString(), "get_weather")
	// tool_use stop reason.
	assert.Equal(t, attribute.StringSliceValue([]string{"tool_use"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// The tool_use response block is recorded as gen_ai.output.messages carrying
	// the tool call, not discarded as empty text and NOT on langwatch.output.
	require.Contains(t, attrs, genAIOutputKey, "tool_use response must record gen_ai.output.messages")
	assert.NotContains(t, attrs, outputKey, "tool_use output must not be on langwatch.output")
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, msgs[0].Role)
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok, "content should be rich parts, got %T", msgs[0].Content)
	require.Len(t, parts, 1)
	toolPart := parts[0].(map[string]any)
	assert.Equal(t, "tool_call", toolPart["type"])
	assert.Equal(t, "get_weather", toolPart["toolName"])
	assert.Equal(t, "toolu_1", toolPart["toolCallId"])
	assert.JSONEq(t, `{"city":"SF"}`, toolPart["args"].(string))
}

func TestMiddleware_Messages_Streaming(t *testing.T) {
	// Anthropic streams typed events with NO [DONE] sentinel. message_start
	// carries the model + initial usage (input + cache tokens); content_block_delta
	// carries text_delta; message_delta carries the final output_tokens + stop_reason.
	const streamBody = `event: message_start
data: {"type":"message_start","message":{"id":"msg_stream_1","type":"message","role":"assistant","model":"claude-haiku-4-5-stream","content":[],"stop_reason":null,"usage":{"input_tokens":18,"output_tokens":1,"cache_read_input_tokens":6,"cache_creation_input_tokens":9}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" there"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":11}}

event: message_stop
data: {"type":"message_stop"}

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)
	client := anthropic.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware(WithTracerProvider(provider))),
	)

	stream := client.Messages.NewStreaming(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeHaiku4_5,
		MaxTokens: 1024,
		Messages: []anthropic.MessageParam{
			anthropic.NewUserMessage(anthropic.NewTextBlock("Greet me")),
		},
	})
	var accumulated string
	for stream.Next() {
		event := stream.Current()
		if event.Type == "content_block_delta" {
			accumulated += event.Delta.Text
		}
	}
	require.NoError(t, stream.Err())
	// Sanity: the client itself reconstructed the same text we expect on the span.
	assert.Equal(t, "Hello there", accumulated)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// A streaming request records gen_ai.request.stream == true (the canonical
	// streaming flag, recorded by the otelhttp base) and a TTFT.
	assert.Equal(t, attribute.BoolValue(true), attrs[attribute.Key("gen_ai.request.stream")])
	require.Contains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"), "streaming must record TTFT")
	assert.GreaterOrEqual(t, attrs[attribute.Key("gen_ai.response.time_to_first_chunk")].AsFloat64(), 0.0)
	assert.Equal(t, attribute.StringValue("msg_stream_1"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("claude-haiku-4-5-stream"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"end_turn"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// Usage from the typed events: input + cache from message_start, output from message_delta.
	assert.Equal(t, attribute.IntValue(18), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(11), attrs[semconv.GenAIUsageOutputTokensKey])
	// total = input + output + cache_read + cache_creation: 18 + 11 + 6 + 9 = 44.
	assert.Equal(t, attribute.IntValue(44), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(6), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	// Cache-creation tokens flow through SetGenAIUsage (gen_ai.usage.cache_creation.input_tokens).
	assert.Equal(t, attribute.IntValue(9), attrs[cacheCreationKey])

	// Output text reconstructed from the accumulated text_delta events, recorded
	// as a gen_ai.output.messages assistant text message (NOT langwatch.output).
	require.Contains(t, attrs, genAIOutputKey, "output text must be captured from the stream")
	assert.NotContains(t, attrs, outputKey, "streamed output must not be on langwatch.output")
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "Hello there", outMsgs[0].Content)
}

func TestMiddleware_Messages_Streaming_Thinking(t *testing.T) {
	// thinking_delta text is also accumulated into the output.
	const streamBody = `event: message_start
data: {"type":"message_start","message":{"id":"msg_think","type":"message","role":"assistant","model":"claude-opus-4-5","content":[],"usage":{"input_tokens":5,"output_tokens":1}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me reason. "}}

event: content_block_delta
data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Answer"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":8}}

event: message_stop
data: {"type":"message_stop"}

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)
	client := anthropic.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware(WithTracerProvider(provider))),
	)

	stream := client.Messages.NewStreaming(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeOpus4_5,
		MaxTokens: 1024,
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("Think"))},
	})
	for stream.Next() {
		_ = stream.Current()
	}
	require.NoError(t, stream.Err())

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	require.Contains(t, attrs, genAIOutputKey, "thinking + text output must be captured")
	assert.NotContains(t, attrs, outputKey, "streamed output must not be on langwatch.output")
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "Let me reason. Answer", outMsgs[0].Content)
}

// TestMiddleware_Messages_Streaming_ToolUse verifies a streamed tool_use block
// (whose JSON args arrive as input_json_delta fragments) is reassembled and
// recorded as chat_messages output carrying the tool call, not dropped.
func TestMiddleware_Messages_Streaming_ToolUse(t *testing.T) {
	const streamBody = `event: message_start
data: {"type":"message_start","message":{"id":"msg_tool_stream","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[],"usage":{"input_tokens":10,"output_tokens":1}}}

event: content_block_start
data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_stream","name":"lookup","input":{}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\"q\":"}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"\"go\"}"}}

event: content_block_stop
data: {"type":"content_block_stop","index":0}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":12}}

event: message_stop
data: {"type":"message_stop"}

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)
	client := anthropic.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware(WithTracerProvider(provider))),
	)

	stream := client.Messages.NewStreaming(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeHaiku4_5,
		MaxTokens: 1024,
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("look up go"))},
	})
	for stream.Next() {
		_ = stream.Current()
	}
	require.NoError(t, stream.Err())

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, attribute.StringSliceValue([]string{"tool_use"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	require.Contains(t, attrs, genAIOutputKey, "streamed tool_use must record gen_ai.output.messages")
	assert.NotContains(t, attrs, outputKey, "streamed tool_use output must not be on langwatch.output")
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, msgs[0].Role)
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok, "content should be rich parts, got %T", msgs[0].Content)
	require.Len(t, parts, 1, "a pure tool_use response has one tool_call part")
	toolPart := parts[0].(map[string]any)
	assert.Equal(t, "tool_call", toolPart["type"])
	assert.Equal(t, "lookup", toolPart["toolName"])
	assert.Equal(t, "toolu_stream", toolPart["toolCallId"])
	assert.JSONEq(t, `{"q":"go"}`, toolPart["args"].(string), "streamed input_json fragments are reassembled")
}

func TestMiddleware_DataCapture_Gating(t *testing.T) {
	const respBody = `{"id":"msg_cap","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[{"type":"text","text":"pong"}],"stop_reason":"end_turn","usage":{"input_tokens":2,"output_tokens":1,"cache_read_input_tokens":3,"cache_creation_input_tokens":0}}`

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
			rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
			provider, exporter := newTestProvider(t)
			client := anthropic.NewClient(
				option.WithAPIKey("dummy-key"),
				option.WithHTTPClient(newMockClient(rt)),
				option.WithMiddleware(Middleware(
					WithTracerProvider(provider),
					WithDataCapture(tc.mode),
				)),
			)

			_, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
				Model:     anthropic.ModelClaudeHaiku4_5,
				MaxTokens: 16,
				System:    []anthropic.TextBlockParam{{Text: "sys"}},
				Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("ping"))},
			})
			require.NoError(t, err)

			span := requireSingleSpan(t, provider, exporter)
			attrs := spanAttrs(span)

			_, hasInput := attrs[genAIInputKey]
			_, hasOutput := attrs[genAIOutputKey]
			_, hasSystem := attrs[genAISystemKey]
			assert.Equal(t, tc.expectInput, hasInput, "input capture (gen_ai.input.messages)")
			assert.Equal(t, tc.expectInput, hasSystem, "system-instructions capture follows input gating")
			assert.Equal(t, tc.expectOutput, hasOutput, "output capture (gen_ai.output.messages)")
			// Chat I/O must never land on the arbitrary langwatch.input/output keys.
			assert.NotContains(t, attrs, inputKey, "chat input must not be on langwatch.input")
			assert.NotContains(t, attrs, outputKey, "chat output must not be on langwatch.output")

			// Usage is always recorded regardless of capture mode.
			assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageInputTokensKey])
			assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageOutputTokensKey])
			assert.Equal(t, attribute.IntValue(3), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
		})
	}
}

func TestMiddleware_DefaultCapturesBoth(t *testing.T) {
	const respBody = `{"id":"msg_def","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[{"type":"text","text":"pong"}],"stop_reason":"end_turn","usage":{"input_tokens":2,"output_tokens":1}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := anthropic.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		// No WithDataCapture: default must capture both input and output.
		option.WithMiddleware(Middleware(WithTracerProvider(provider))),
	)

	_, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeHaiku4_5,
		MaxTokens: 16,
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("ping"))},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Contains(t, attrs, genAIInputKey, "default capture should record gen_ai.input.messages")
	assert.Contains(t, attrs, genAIOutputKey, "default capture should record gen_ai.output.messages")
}

func TestMiddleware_WithGenAIProvider(t *testing.T) {
	const respBody = `{"id":"msg_p","type":"message","role":"assistant","model":"claude-haiku-4-5","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := anthropic.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware(
			WithTracerProvider(provider),
			WithGenAIProvider(semconv.GenAIProviderNameKey.String("aws.bedrock")),
		)),
	)

	_, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeHaiku4_5,
		MaxTokens: 16,
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("ping"))},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	// The overridden provider is recorded as gen_ai.provider.name regardless of
	// the final span name (the extractor renames the span to messages.<model>).
	assert.Equal(t, attribute.StringValue("aws.bedrock"), attrs[semconv.GenAIProviderNameKey])
	assert.Equal(t, "messages."+string(anthropic.ModelClaudeHaiku4_5), span.Name())
}

func TestMiddleware_APIError(t *testing.T) {
	rt := &mockRoundTripper{
		statusCode:  http.StatusBadRequest,
		respBody:    `{"type":"error","error":{"type":"invalid_request_error","message":"bad"}}`,
		contentType: "application/json",
	}
	provider, exporter := newTestProvider(t)
	client := anthropic.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware(WithTracerProvider(provider))),
	)

	_, err := client.Messages.New(context.Background(), anthropic.MessageNewParams{
		Model:     anthropic.ModelClaudeHaiku4_5,
		MaxTokens: 16,
		Messages:  []anthropic.MessageParam{anthropic.NewUserMessage(anthropic.NewTextBlock("ping"))},
	})
	require.Error(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Equal(t, codes.Error, span.Status().Code)
	assert.Equal(t, attribute.IntValue(http.StatusBadRequest), attrs[semconv.HTTPResponseStatusCodeKey])
}

func TestMiddleware_NextReturnsError(t *testing.T) {
	provider, exporter := newTestProvider(t)

	expectedError := errors.New("mock next error")
	var nextFunc option.MiddlewareNext = func(req *http.Request) (*http.Response, error) {
		return nil, expectedError
	}

	mw := Middleware(WithTracerProvider(provider))
	req := httptest.NewRequest(http.MethodPost, "https://api.anthropic.com/v1/messages", nil)
	_, err := mw(req, nextFunc)
	require.Error(t, err)
	assert.Equal(t, expectedError, err)

	span := requireSingleSpan(t, provider, exporter)
	assert.Equal(t, codes.Error, span.Status().Code)
	assert.Equal(t, expectedError.Error(), span.Status().Description)

	foundErrorEvent := false
	for _, event := range span.Events() {
		if event.Name == "exception" {
			foundErrorEvent = true
		}
	}
	assert.True(t, foundErrorEvent, "expected an exception event to be recorded")
}
