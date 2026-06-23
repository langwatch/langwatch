package gopenai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	openai "github.com/sashabaranov/go-openai"
)

func TestChatCompletion_NonStreaming(t *testing.T) {
	const respBody = `{"id":"cmpl-xyz","object":"chat.completion","created":1700000000,"model":"gpt-test-resp","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3,"prompt_tokens_details":{"cached_tokens":1},"completion_tokens_details":{"reasoning_tokens":4}},"system_fingerprint":"fp_test_value"}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(rt, WithTracerProvider(provider))

	_, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:       openai.GPT4oMini,
		Messages:    []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "ping"}},
		MaxTokens:   5,
		Temperature: 0.7,
		TopP:        0.9,
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, "chat."+openai.GPT4oMini, span.Name())
	assert.Equal(t, codes.Ok, span.Status().Code)
	assert.Equal(t, attribute.StringValue("chat"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue(openai.GPT4oMini), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.StringValue("openai"), attrs[semconv.GenAIProviderNameKey])
	assert.Equal(t, attribute.Float64Value(0.7), attrs[semconv.GenAIRequestTemperatureKey])
	assert.Equal(t, attribute.Float64Value(0.9), attrs[semconv.GenAIRequestTopPKey])
	assert.Equal(t, attribute.IntValue(5), attrs[semconv.GenAIRequestMaxTokensKey])

	// Response identity + model.
	assert.Equal(t, attribute.StringValue("cmpl-xyz"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("gpt-test-resp"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("fp_test_value"), attrs[semconv.OpenAIResponseSystemFingerprintKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// A non-streaming request records gen_ai.request.stream == false and no TTFT.
	assert.Equal(t, attribute.BoolValue(false), attrs[attribute.Key("gen_ai.request.stream")])
	assert.NotContains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"))

	// All token kinds, including cached + reasoning.
	assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(3), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(1), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	assert.Equal(t, attribute.IntValue(4), attrs[attribute.Key("gen_ai.usage.reasoning.output_tokens")])

	// Default capture mode is All. Chat request/response messages are recorded in
	// the gen_ai-native format (raw JSON arrays), NOT under langwatch.input/output.
	require.Contains(t, attrs, genAIInputKey, "chat input must be recorded under gen_ai.input.messages")
	inMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleUser, inMsgs[0].Role)
	assert.Equal(t, "ping", inMsgs[0].Content)

	require.Contains(t, attrs, genAIOutputKey, "chat output must be recorded under gen_ai.output.messages")
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "pong", outMsgs[0].Content)

	// Chat message I/O must not leak onto the arbitrary-content langwatch keys.
	assert.NotContains(t, attrs, inputKey, "chat input must not be recorded under langwatch.input")
	assert.NotContains(t, attrs, outputKey, "chat output must not be recorded under langwatch.output")
}

func TestChatCompletion_Streaming(t *testing.T) {
	const streamBody = `data: {"id":"cmpl-str","object":"chat.completion.chunk","created":1700000100,"model":"gpt-stream-resp","system_fingerprint":"fp_stream_test","choices":[{"index":0,"delta":{"role":"assistant","content":"one"},"finish_reason":null}]}

data: {"id":"cmpl-str","object":"chat.completion.chunk","created":1700000100,"model":"gpt-stream-resp","choices":[{"index":0,"delta":{"content":" two"},"finish_reason":"stop"}]}

data: {"id":"cmpl-str","object":"chat.completion.chunk","model":"gpt-stream-resp","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":2,"total_tokens":6,"prompt_tokens_details":{"cached_tokens":3}}}

data: [DONE]

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(rt, WithTracerProvider(provider))

	stream, err := client.CreateChatCompletionStream(context.Background(), openai.ChatCompletionRequest{
		Model:         openai.GPT4oMini,
		Messages:      []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "count"}},
		StreamOptions: &openai.StreamOptions{IncludeUsage: true},
	})
	require.NoError(t, err)

	// Drain the stream to end-of-stream, exactly as a real consumer would.
	for {
		_, recvErr := stream.Recv()
		if errors.Is(recvErr, io.EOF) {
			break
		}
		require.NoError(t, recvErr)
	}
	require.NoError(t, stream.Close())

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

	// Usage arrives in the final chunk (stream_options.include_usage).
	assert.Equal(t, attribute.IntValue(4), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(6), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(3), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])

	// Streamed deltas are accumulated into a gen_ai-native chat output message,
	// NOT under langwatch.output.
	require.Contains(t, attrs, genAIOutputKey, "streamed chat output must be recorded under gen_ai.output.messages")
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "one two", outMsgs[0].Content)
	assert.NotContains(t, attrs, outputKey, "streamed chat output must not be recorded under langwatch.output")
}

func TestCompletion_Legacy_NonStreaming(t *testing.T) {
	const respBody = `{"id":"cmpl-leg","object":"text_completion","created":1700000000,"model":"gpt-3.5-turbo-instruct","choices":[{"index":0,"text":"  the answer","finish_reason":"length"}],"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(rt, WithTracerProvider(provider))

	_, err := client.CreateCompletion(context.Background(), openai.CompletionRequest{
		Model:       "gpt-3.5-turbo-instruct",
		Prompt:      "Q: 2+2? A:",
		MaxTokens:   8,
		Temperature: 0.5,
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// /v1/completions maps to the text_completion operation.
	assert.Equal(t, semconv.GenAIOperationNameTextCompletion.Value, attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("gpt-3.5-turbo-instruct"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.StringValue("cmpl-leg"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringValue("gpt-3.5-turbo-instruct"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"length"}), attrs[semconv.GenAIResponseFinishReasonsKey])
	assert.Equal(t, attribute.IntValue(3), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageOutputTokensKey])

	// Legacy completions are the non-chat API: the prompt and the answer are
	// arbitrary content recorded under langwatch.input/output, NOT the gen_ai chat
	// message keys.
	outputTV := parseTypedValue(t, attrs[outputKey].AsString())
	assert.Equal(t, "text", outputTV.Type)
	assert.JSONEq(t, `"  the answer"`, string(outputTV.Value))
	assert.NotContains(t, attrs, genAIOutputKey, "legacy completions answer is not a chat message")

	// The prompt is recorded on langwatch.input (non-chat), not gen_ai.input.messages.
	require.Contains(t, attrs, inputKey, "legacy completions prompt must be recorded under langwatch.input")
	inputTV := parseTypedValue(t, attrs[inputKey].AsString())
	assert.Equal(t, "text", inputTV.Type)
	assert.JSONEq(t, `"Q: 2+2? A:"`, string(inputTV.Value))
	assert.NotContains(t, attrs, genAIInputKey, "legacy completions prompt is not a chat message")
}

func TestEmbeddings_NonStreaming(t *testing.T) {
	const respBody = `{"object":"list","model":"text-embedding-3-small","data":[{"object":"embedding","index":0,"embedding":[0.1,0.2,0.3]}],"usage":{"prompt_tokens":6,"total_tokens":6}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(rt, WithTracerProvider(provider))

	_, err := client.CreateEmbeddings(context.Background(), openai.EmbeddingRequest{
		Model:          openai.SmallEmbedding3,
		Input:          "embed me",
		EncodingFormat: openai.EmbeddingEncodingFormatFloat,
		Dimensions:     256,
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, "embeddings."+string(openai.SmallEmbedding3), span.Name())
	assert.Equal(t, attribute.StringValue("embeddings"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue(string(openai.SmallEmbedding3)), attrs[semconv.GenAIRequestModelKey])
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

func TestDataCapture_Gating(t *testing.T) {
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
			client := newTracedClient(rt, WithTracerProvider(provider), WithDataCapture(tc.mode))

			_, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
				Model:    openai.GPT4oMini,
				Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "ping"}},
			})
			require.NoError(t, err)

			span := requireSingleSpan(t, provider, exporter)
			attrs := spanAttrs(span)

			// Chat I/O is gated under the gen_ai-native message keys.
			_, hasInput := attrs[genAIInputKey]
			_, hasOutput := attrs[genAIOutputKey]
			assert.Equal(t, tc.expectInput, hasInput, "input capture")
			assert.Equal(t, tc.expectOutput, hasOutput, "output capture")

			// Chat I/O never leaks onto the arbitrary-content langwatch keys.
			assert.NotContains(t, attrs, inputKey, "chat input must not use langwatch.input")
			assert.NotContains(t, attrs, outputKey, "chat output must not use langwatch.output")

			// Usage is always recorded regardless of capture mode.
			assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageInputTokensKey])
			assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageOutputTokensKey])
		})
	}
}

func TestDataCapture_None_GatesStreaming(t *testing.T) {
	const streamBody = `data: {"id":"cmpl-str","object":"chat.completion.chunk","model":"gpt-stream","choices":[{"index":0,"delta":{"content":"secret"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1,"total_tokens":2}}

data: [DONE]

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(rt, WithTracerProvider(provider), WithDataCapture(langwatch.DataCaptureNone))

	stream, err := client.CreateChatCompletionStream(context.Background(), openai.ChatCompletionRequest{
		Model:    openai.GPT4oMini,
		Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "ping"}},
	})
	require.NoError(t, err)
	for {
		_, recvErr := stream.Recv()
		if errors.Is(recvErr, io.EOF) {
			break
		}
		require.NoError(t, recvErr)
	}
	require.NoError(t, stream.Close())

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Content is gated, but usage + finish reason are still recorded. The streamed
	// chat content is recorded under the gen_ai keys, so the gate is observed there
	// as well as on the langwatch keys.
	assert.NotContains(t, attrs, genAIInputKey, "chat input gated under DataCaptureNone")
	assert.NotContains(t, attrs, genAIOutputKey, "chat output gated under DataCaptureNone")
	assert.NotContains(t, attrs, inputKey, "input gated under DataCaptureNone")
	assert.NotContains(t, attrs, outputKey, "output gated under DataCaptureNone")
	assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])
}

func TestWithGenAIProvider_OverridesDefault(t *testing.T) {
	const respBody = `{"id":"cmpl-xyz","object":"chat.completion","model":"llama-3.3-70b","choices":[{"index":0,"message":{"role":"assistant","content":"hola"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`

	// go-openai is widely used against OpenAI-compatible providers; a custom
	// gen_ai.provider.name (here Groq) is the real-world override.
	groq := semconv.GenAIProviderNameKey.String("groq")

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(rt,
		WithTracerProvider(provider),
		WithGenAIProvider(groq),
	)

	_, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:    "llama-3.3-70b",
		Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "hi"}},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Equal(t, groq.Value, attrs[semconv.GenAIProviderNameKey])
	// The span name is still derived from the request model by the chat extractor.
	assert.Equal(t, "chat.llama-3.3-70b", span.Name())
}

func TestNewTransport_DirectWiring(t *testing.T) {
	const respBody = `{"id":"cmpl-xyz","object":"chat.completion","model":"gpt-test","choices":[{"index":0,"message":{"role":"assistant","content":"pong"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)

	// Wire the transport directly onto the config, chaining the mock as the base.
	config := openai.DefaultConfig("dummy-key")
	config.HTTPClient = &http.Client{Transport: NewTransportWithBase(rt, WithTracerProvider(provider))}
	client := openai.NewClientWithConfig(config)

	_, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:    openai.GPT4oMini,
		Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "ping"}},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	assert.Equal(t, codes.Ok, span.Status().Code)
	assert.Equal(t, attribute.IntValue(2), spanAttrs(span)[semconv.GenAIUsageInputTokensKey])
}

func TestAPIError(t *testing.T) {
	rt := &mockRoundTripper{
		statusCode:  http.StatusBadRequest,
		respBody:    `{"error":{"message":"invalid","type":"invalid_request_error"}}`,
		contentType: "application/json",
	}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(rt, WithTracerProvider(provider))

	_, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:    openai.GPT4oMini,
		Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "ping"}},
	})
	require.Error(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Equal(t, codes.Error, span.Status().Code)
	assert.Equal(t, attribute.IntValue(http.StatusBadRequest), attrs[semconv.HTTPResponseStatusCodeKey])
}
