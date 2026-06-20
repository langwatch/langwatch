package openai

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/responses"
)

func TestMiddleware_ChatCompletion_NonStreaming(t *testing.T) {
	const respBody = `{"id":"cmpl-xyz","object":"chat.completion","created":1700000000,"model":"gpt-test-resp","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3,"prompt_tokens_details":{"cached_tokens":1}},"system_fingerprint":"fp_test_value"}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model:       openai.ChatModelGPT4oMini,
		Messages:    []openai.ChatCompletionMessageParamUnion{openai.UserMessage("ping")},
		MaxTokens:   openai.Opt(int64(5)),
		Temperature: openai.Opt(0.7),
		TopP:        openai.Opt(0.9),
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, "chat."+string(openai.ChatModelGPT4oMini), span.Name())
	assert.Equal(t, codes.Ok, span.Status().Code)
	assert.Equal(t, attribute.StringValue("chat"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue(string(openai.ChatModelGPT4oMini)), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.Float64Value(0.7), attrs[semconv.GenAIRequestTemperatureKey])
	assert.Equal(t, attribute.Float64Value(0.9), attrs[semconv.GenAIRequestTopPKey])
	assert.Equal(t, attribute.IntValue(5), attrs[semconv.GenAIRequestMaxTokensKey])
	assert.Equal(t, attribute.StringValue("cmpl-xyz"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("gpt-test-resp"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("fp_test_value"), attrs[semconv.OpenAIResponseSystemFingerprintKey])
	assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(1), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// A non-streaming request records gen_ai.request.stream == false and no TTFT.
	assert.Equal(t, attribute.BoolValue(false), attrs[attribute.Key("gen_ai.request.stream")])
	assert.NotContains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"))

	// Default capture mode is All. LLM chat messages are recorded under the
	// gen_ai.* keys, not the langwatch.input/output typed envelope.
	inMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleUser, inMsgs[0].Role)
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "pong", outMsgs[0].Content)
	// Chat I/O is NOT under langwatch.input/output.
	assert.NotContains(t, attrs, inputKey)
	assert.NotContains(t, attrs, outputKey)
}

func TestMiddleware_ChatCompletion_Streaming(t *testing.T) {
	const streamBody = `data: {"id":"cmpl-str","object":"chat.completion.chunk","created":1700000100,"model":"gpt-stream-resp","system_fingerprint":"fp_stream_test","choices":[{"index":0,"delta":{"role":"assistant","content":"one"},"finish_reason":null}]}

data: {"id":"cmpl-str","object":"chat.completion.chunk","created":1700000100,"model":"gpt-stream-resp","choices":[{"index":0,"delta":{"content":" two"},"finish_reason":"stop"}]}

data: {"id":"cmpl-str","object":"chat.completion.chunk","model":"gpt-stream-resp","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6}}

data: [DONE]

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	stream := client.Chat.Completions.NewStreaming(context.Background(), openai.ChatCompletionNewParams{
		Model:    openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("count")},
	})
	for stream.Next() {
		_ = stream.Current()
	}
	require.NoError(t, stream.Err())

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// A streaming request records gen_ai.request.stream == true and a TTFT.
	assert.Equal(t, attribute.BoolValue(true), attrs[attribute.Key("gen_ai.request.stream")])
	require.Contains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"), "streaming must record TTFT")
	assert.GreaterOrEqual(t, attrs[attribute.Key("gen_ai.response.time_to_first_chunk")].AsFloat64(), 0.0)
	assert.Equal(t, attribute.StringValue("cmpl-str"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("gpt-stream-resp"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("fp_stream_test"), attrs[semconv.OpenAIResponseSystemFingerprintKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])
	// Usage arrives in the final chunk.
	assert.Equal(t, attribute.IntValue(4), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageOutputTokensKey])

	// Streamed deltas are accumulated into a gen_ai assistant output message.
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "one two", outMsgs[0].Content)
	assert.NotContains(t, attrs, outputKey)
}

func TestMiddleware_Responses_NonStreaming(t *testing.T) {
	const respBody = `{"id":"resp_123","object":"response","model":"gpt-4o","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Ahoy there!"}]}],"usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18,"input_tokens_details":{"cached_tokens":4},"output_tokens_details":{"reasoning_tokens":3}}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model:        openai.ChatModelGPT4oMini,
		Input:        responses.ResponseNewParamsInputUnion{OfString: openai.Opt("Hello, OpenAI!")},
		Instructions: openai.Opt("You are a helpful assistant."),
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, attribute.StringValue("responses"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("resp_123"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("gpt-4o"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("completed"), attrs[attribute.Key("gen_ai.response.status")])
	assert.Equal(t, attribute.IntValue(11), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(7), attrs[semconv.GenAIUsageOutputTokensKey])
	// Cached + reasoning tokens are extracted from the usage details.
	assert.Equal(t, attribute.IntValue(4), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	assert.Equal(t, attribute.IntValue(3), attrs[attribute.Key("gen_ai.usage.reasoning.output_tokens")])

	// Instructions are the system prompt, recorded under gen_ai.system_instructions
	// (not langwatch.instructions); the string input is a user message recorded
	// under gen_ai.input.messages.
	assert.Equal(t, attribute.StringValue("You are a helpful assistant."), attrs[genAISystemKey])
	assert.NotContains(t, attrs, langwatch.AttributeLangWatchInstructions)
	inMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleUser, inMsgs[0].Role)
	assert.Equal(t, "Hello, OpenAI!", inMsgs[0].Content)

	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "Ahoy there!", outMsgs[0].Content)
	// Chat I/O is NOT under langwatch.input/output.
	assert.NotContains(t, attrs, inputKey)
	assert.NotContains(t, attrs, outputKey)
}

// TestMiddleware_Responses_Streaming covers the previously-broken Responses
// streaming path: the response is a sequence of typed events (output_text.delta
// + response.completed) with NO [DONE] sentinel. It asserts the output text and
// input/output token usage are captured from the stream.
func TestMiddleware_Responses_Streaming(t *testing.T) {
	const streamBody = `event: response.created
data: {"type":"response.created","sequence_number":0,"response":{"id":"resp_str","object":"response","model":"gpt-4o","status":"in_progress","output":[]}}

event: response.output_text.delta
data: {"type":"response.output_text.delta","sequence_number":1,"item_id":"msg_1","output_index":0,"content_index":0,"delta":"Hello"}

event: response.output_text.delta
data: {"type":"response.output_text.delta","sequence_number":2,"item_id":"msg_1","output_index":0,"content_index":0,"delta":" world"}

event: response.completed
data: {"type":"response.completed","sequence_number":3,"response":{"id":"resp_str","object":"response","model":"gpt-4o","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello world"}]}],"usage":{"input_tokens":9,"output_tokens":5,"total_tokens":14,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":2}}}}

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	stream := client.Responses.NewStreaming(context.Background(), responses.ResponseNewParams{
		Model: openai.ChatModelGPT4oMini,
		Input: responses.ResponseNewParamsInputUnion{OfString: openai.Opt("Say hi")},
	})
	for stream.Next() {
		_ = stream.Current()
	}
	require.NoError(t, stream.Err())

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, attribute.BoolValue(true), attrs[attribute.Key("gen_ai.request.stream")])
	assert.Equal(t, attribute.StringValue("resp_str"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("gpt-4o"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("completed"), attrs[attribute.Key("gen_ai.response.status")])

	// Usage and reasoning tokens come from the response.completed event.
	require.Contains(t, attrs, semconv.GenAIUsageInputTokensKey, "input tokens must be captured from Responses stream")
	assert.Equal(t, attribute.IntValue(9), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(5), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(2), attrs[attribute.Key("gen_ai.usage.reasoning.output_tokens")])

	// The output text is reconstructed from the stream (completed event's
	// OutputText, which matches the accumulated deltas) and recorded as a gen_ai
	// assistant output message.
	require.Contains(t, attrs, genAIOutputKey, "output text must be captured from Responses stream")
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "Hello world", outMsgs[0].Content)
	assert.NotContains(t, attrs, outputKey)
}

// TestMiddleware_Responses_Streaming_DeltaFallback verifies that when the
// completed event carries no output text, the accumulated deltas are used.
func TestMiddleware_Responses_Streaming_DeltaFallback(t *testing.T) {
	const streamBody = `data: {"type":"response.output_text.delta","sequence_number":1,"delta":"partial "}

data: {"type":"response.output_text.delta","sequence_number":2,"delta":"answer"}

data: {"type":"response.completed","sequence_number":3,"response":{"id":"resp_d","object":"response","model":"gpt-4o","status":"completed","output":[],"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5,"input_tokens_details":{"cached_tokens":0},"output_tokens_details":{"reasoning_tokens":0}}}}

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	stream := client.Responses.NewStreaming(context.Background(), responses.ResponseNewParams{
		Model: openai.ChatModelGPT4oMini,
		Input: responses.ResponseNewParamsInputUnion{OfString: openai.Opt("hi")},
	})
	for stream.Next() {
		_ = stream.Current()
	}
	require.NoError(t, stream.Err())

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "partial answer", outMsgs[0].Content)
	assert.NotContains(t, attrs, outputKey)
}

func TestMiddleware_Embeddings_NonStreaming(t *testing.T) {
	const respBody = `{"object":"list","model":"text-embedding-3-small","data":[{"object":"embedding","index":0,"embedding":[0.1,0.2,0.3]}],"usage":{"prompt_tokens":6,"total_tokens":6}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Embeddings.New(context.Background(), openai.EmbeddingNewParams{
		Model:          openai.EmbeddingModelTextEmbedding3Small,
		Input:          openai.EmbeddingNewParamsInputUnion{OfString: openai.Opt("embed me")},
		EncodingFormat: openai.EmbeddingNewParamsEncodingFormatFloat,
		Dimensions:     openai.Opt(int64(256)),
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, "embeddings."+string(openai.EmbeddingModelTextEmbedding3Small), span.Name())
	assert.Equal(t, attribute.StringValue("embeddings"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue(string(openai.EmbeddingModelTextEmbedding3Small)), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.StringValue("text-embedding-3-small"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.IntValue(6), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(6), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	// Embeddings have no completion tokens.
	assert.NotContains(t, attrs, semconv.GenAIUsageOutputTokensKey)
	assert.Equal(t, attribute.IntValue(256), attrs[semconv.GenAIEmbeddingsDimensionCountKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"float"}), attrs[semconv.GenAIRequestEncodingFormatsKey])

	// Embeddings never stream.
	assert.Equal(t, attribute.BoolValue(false), attrs[attribute.Key("gen_ai.request.stream")])

	// Input recorded; output records only the vector count (not the vectors).
	inputTV := parseTypedValue(t, attrs[inputKey].AsString())
	assert.Equal(t, "text", inputTV.Type)
	assert.Equal(t, attribute.IntValue(1), attrs[attribute.Key("gen_ai.response.embeddings_count")])
}

// TestMiddleware_GenericFallback covers an unknown endpoint that no typed
// extractor claims: the generic fallback still records model and usage.
func TestMiddleware_GenericFallback(t *testing.T) {
	// A moderations-style payload: no messages, no input/instructions, unknown
	// response object — only the generic extractor matches.
	const respBody = `{"id":"modr-1","object":"moderation","model":"text-moderation-007","results":[{"flagged":false}]}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Moderations.New(context.Background(), openai.ModerationNewParams{
		Input: openai.ModerationNewParamsInputUnion{OfString: openai.Opt("check this")},
		Model: openai.ModerationModelOmniModerationLatest,
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// The request had a model, so the generic extractor named the span and set
	// the request model.
	assert.Equal(t, attribute.StringValue(string(openai.ModerationModelOmniModerationLatest)), attrs[semconv.GenAIRequestModelKey])
	// The generic extractor read id + model off the unknown response shape.
	assert.Equal(t, attribute.StringValue("modr-1"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("text-moderation-007"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, codes.Ok, span.Status().Code)
}

func TestMiddleware_DataCapture_Gating(t *testing.T) {
	const respBody = `{"id":"cmpl-xyz","object":"chat.completion","model":"gpt-test","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`

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
			client := openai.NewClient(
				option.WithAPIKey("dummy-key"),
				option.WithHTTPClient(newMockClient(rt)),
				option.WithMiddleware(Middleware("test-client",
					WithTracerProvider(provider),
					WithDataCapture(tc.mode),
				)),
			)

			_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
				Model:    openai.ChatModelGPT4oMini,
				Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("ping")},
			})
			require.NoError(t, err)

			span := requireSingleSpan(t, provider, exporter)
			attrs := spanAttrs(span)

			// Chat messages are recorded under the gen_ai.* keys, gated by mode.
			_, hasInput := attrs[genAIInputKey]
			_, hasOutput := attrs[genAIOutputKey]
			assert.Equal(t, tc.expectInput, hasInput, "input capture")
			assert.Equal(t, tc.expectOutput, hasOutput, "output capture")

			// Usage is always recorded regardless of capture mode.
			assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageInputTokensKey])
			assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageOutputTokensKey])
		})
	}
}

func TestMiddleware_DefaultCapturesBoth(t *testing.T) {
	const respBody = `{"id":"cmpl-xyz","object":"chat.completion","model":"gpt-test","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		// No WithDataCapture: default must capture both input and output.
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model:    openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("ping")},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Contains(t, attrs, genAIInputKey, "default capture should record input")
	assert.Contains(t, attrs, genAIOutputKey, "default capture should record output")
}

func TestMiddleware_APIError(t *testing.T) {
	rt := &mockRoundTripper{
		statusCode:  http.StatusBadRequest,
		respBody:    `{"error":{"message":"invalid","type":"invalid_request_error"}}`,
		contentType: "application/json",
	}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model:    openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("ping")},
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

	middleware := Middleware("testClient", WithTracerProvider(provider))
	req := httptest.NewRequest(http.MethodPost, "http://localhost/v1/chat/completions", nil)
	_, err := middleware(req, nextFunc)
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

func TestMiddleware_NextReturnsErrorWithResponse(t *testing.T) {
	provider, exporter := newTestProvider(t)

	expectedError := errors.New("mock next error with response")
	mockResponse := &http.Response{StatusCode: http.StatusInternalServerError, Body: http.NoBody}
	var nextFunc option.MiddlewareNext = func(req *http.Request) (*http.Response, error) {
		return mockResponse, expectedError
	}

	middleware := Middleware("testClient", WithTracerProvider(provider))
	req := httptest.NewRequest(http.MethodPost, "http://localhost/v1/chat/completions", nil)
	resp, err := middleware(req, nextFunc)
	require.Error(t, err)
	assert.Equal(t, expectedError, err)
	assert.Equal(t, mockResponse, resp)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Equal(t, codes.Error, span.Status().Code)
	assert.Equal(t, attribute.IntValue(http.StatusInternalServerError), attrs[semconv.HTTPResponseStatusCodeKey])
}

// TestMiddleware_WithTracerProvider_NoGlobal verifies WithTracerProvider works
// without setting the global tracer provider.
func TestMiddleware_WithTracerProvider_NoGlobal(t *testing.T) {
	const respBody = `{"id":"cmpl-xyz","object":"chat.completion","model":"gpt-test","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("testClient", WithTracerProvider(provider))),
	)

	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model:    openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("ping")},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	assert.Equal(t, codes.Ok, span.Status().Code)
}
