package ollama

import (
	"context"
	"encoding/json"
	"net/url"
	"testing"

	"github.com/ollama/ollama/api"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

func TestChat_NonStreaming(t *testing.T) {
	// stream:false → the server returns a single JSON object (application/json).
	const respBody = `{"model":"llama3.2","created_at":"2024-01-01T00:00:00Z","message":{"role":"assistant","content":"pong"},"done":true,"done_reason":"stop","total_duration":5000000000,"load_duration":1000000000,"prompt_eval_count":11,"prompt_eval_duration":2000000000,"eval_count":7,"eval_duration":3000000000}`

	rt := &mockRoundTripper{statusCode: 200, respBody: respBody, contentType: "application/json"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	err := client.Chat(context.Background(), &api.ChatRequest{
		Model:    "llama3.2",
		Stream:   boolPtr(false),
		Messages: []api.Message{{Role: "user", Content: "ping"}},
		Options: map[string]any{
			"temperature": 0.7,
			"top_p":       0.9,
			"top_k":       40,
			"num_predict": 64,
			"seed":        42,
			"stop":        []string{"\n\n"},
		},
	}, func(api.ChatResponse) error { return nil })
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, "chat.llama3.2", span.Name())
	assert.Equal(t, codes.Ok, span.Status().Code)
	assert.Equal(t, attribute.StringValue("chat"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("llama3.2"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.StringValue("ollama"), attrs[semconv.GenAIProviderNameKey])

	// A non-streaming request (stream:false) records gen_ai.request.stream == false
	// and no TTFT.
	assert.Equal(t, attribute.BoolValue(false), attrs[attribute.Key("gen_ai.request.stream")])
	assert.NotContains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"))

	// Request params from the options map.
	assert.Equal(t, attribute.Float64Value(0.7), attrs[semconv.GenAIRequestTemperatureKey])
	assert.Equal(t, attribute.Float64Value(0.9), attrs[semconv.GenAIRequestTopPKey])
	assert.Equal(t, attribute.Float64Value(40), attrs[semconv.GenAIRequestTopKKey])
	assert.Equal(t, attribute.IntValue(64), attrs[semconv.GenAIRequestMaxTokensKey])
	assert.Equal(t, attribute.IntValue(42), attrs[semconv.GenAIRequestSeedKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"\n\n"}), attrs[semconv.GenAIRequestStopSequencesKey])

	// Response model + finish reason.
	assert.Equal(t, attribute.StringValue("llama3.2"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// Usage: prompt_eval_count → input, eval_count → output, total = sum.
	assert.Equal(t, attribute.IntValue(11), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(7), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(18), attrs[attribute.Key("gen_ai.usage.total_tokens")])

	// Phase latencies recorded in seconds.
	assert.Equal(t, attribute.Float64Value(3), attrs[attribute.Key("langwatch.ollama.eval_duration")])

	// Request/response messages are recorded gen_ai-native, not on langwatch.input/output.
	require.Contains(t, attrs, genAIInputKey, "gen_ai.input.messages must be recorded")
	require.Contains(t, attrs, genAIOutputKey, "gen_ai.output.messages must be recorded")
	assert.NotContains(t, attrs, inputKey, "chat input must not be on langwatch.input")
	assert.NotContains(t, attrs, outputKey, "chat output must not be on langwatch.output")

	inMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inMsgs, 1)
	assert.Equal(t, "user", inMsgs[0].Role)
	assert.Equal(t, "ping", inMsgs[0].Content)

	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, "assistant", outMsgs[0].Role)
	assert.Equal(t, "pong", outMsgs[0].Content)
}

func TestChat_NonStreaming_ToolCalls(t *testing.T) {
	// The assistant message carries a tool_call; it must be preserved structurally.
	const respBody = `{"model":"llama3.2","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"get_weather","arguments":{"city":"London"}}}]},"done":true,"done_reason":"stop","prompt_eval_count":20,"eval_count":15}`

	rt := &mockRoundTripper{statusCode: 200, respBody: respBody, contentType: "application/json"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	err := client.Chat(context.Background(), &api.ChatRequest{
		Model:    "llama3.2",
		Stream:   boolPtr(false),
		Messages: []api.Message{{Role: "user", Content: "weather in London?"}},
		Tools: api.Tools{{
			Type:     "function",
			Function: api.ToolFunction{Name: "get_weather", Description: "get weather"},
		}},
	}, func(api.ChatResponse) error { return nil })
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Tools recorded on the request.
	require.Contains(t, attrs, attribute.Key("gen_ai.request.tools"))

	// Output is gen_ai.output.messages with the tool call captured structurally,
	// not on langwatch.output.
	assert.NotContains(t, attrs, outputKey, "chat output must not be on langwatch.output")
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	require.Len(t, msgs[0].ToolCalls, 1)
	assert.Equal(t, "get_weather", msgs[0].ToolCalls[0].Function.Name)
	// Arguments are recorded as a JSON-encoded string (LangWatch convention).
	assert.JSONEq(t, `{"city":"London"}`, msgs[0].ToolCalls[0].Function.Arguments)
}

func TestChat_Streaming(t *testing.T) {
	// NDJSON: partial content lines, then a final line with done:true + counts.
	const streamBody = `{"model":"llama3.2","created_at":"2024-01-01T00:00:00Z","message":{"role":"assistant","content":"one"},"done":false}
{"model":"llama3.2","message":{"role":"assistant","content":" two"},"done":false}
{"model":"llama3.2","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","total_duration":4000000000,"prompt_eval_count":4,"eval_count":2,"eval_duration":2000000000}
`

	rt := &mockRoundTripper{statusCode: 200, respBody: streamBody, contentType: "application/x-ndjson"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	var chunks int
	err := client.Chat(context.Background(), &api.ChatRequest{
		Model:    "llama3.2",
		Messages: []api.Message{{Role: "user", Content: "count"}},
	}, func(api.ChatResponse) error { chunks++; return nil })
	require.NoError(t, err)
	assert.Equal(t, 3, chunks, "all NDJSON lines delivered to the consumer")

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// A streaming request records gen_ai.request.stream == true and a TTFT.
	assert.Equal(t, attribute.BoolValue(true), attrs[attribute.Key("gen_ai.request.stream")])
	require.Contains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"), "streaming must record TTFT")
	assert.GreaterOrEqual(t, attrs[attribute.Key("gen_ai.response.time_to_first_chunk")].AsFloat64(), 0.0)
	assert.Equal(t, attribute.StringValue("llama3.2"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// Usage arrives in the final line.
	assert.Equal(t, attribute.IntValue(4), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(6), attrs[attribute.Key("gen_ai.usage.total_tokens")])

	// Streamed deltas accumulated into the gen_ai.output.messages assistant message.
	assert.NotContains(t, attrs, outputKey, "chat output must not be on langwatch.output")
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	assert.Equal(t, "one two", msgs[0].Content)
}

func TestChat_Streaming_ToolCalls(t *testing.T) {
	// Streamed tool call arrives on the final line; it must land structurally.
	const streamBody = `{"model":"llama3.2","message":{"role":"assistant","content":"checking"},"done":false}
{"model":"llama3.2","message":{"role":"assistant","content":"","tool_calls":[{"function":{"name":"lookup","arguments":{"q":"x"}}}]},"done":true,"done_reason":"stop","prompt_eval_count":9,"eval_count":4}
`

	rt := &mockRoundTripper{statusCode: 200, respBody: streamBody, contentType: "application/x-ndjson"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	err := client.Chat(context.Background(), &api.ChatRequest{
		Model:    "llama3.2",
		Messages: []api.Message{{Role: "user", Content: "use a tool"}},
	}, func(api.ChatResponse) error { return nil })
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.NotContains(t, attrs, outputKey, "chat output must not be on langwatch.output")
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	assert.Equal(t, "checking", msgs[0].Content)
	require.Len(t, msgs[0].ToolCalls, 1)
	assert.Equal(t, "lookup", msgs[0].ToolCalls[0].Function.Name)
	assert.JSONEq(t, `{"q":"x"}`, msgs[0].ToolCalls[0].Function.Arguments)
}

func TestGenerate_NonStreaming(t *testing.T) {
	const respBody = `{"model":"llama3.2","created_at":"2024-01-01T00:00:00Z","response":"the answer is 4","done":true,"done_reason":"stop","total_duration":2000000000,"prompt_eval_count":8,"eval_count":5}`

	rt := &mockRoundTripper{statusCode: 200, respBody: respBody, contentType: "application/json"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	err := client.Generate(context.Background(), &api.GenerateRequest{
		Model:   "llama3.2",
		Prompt:  "what is 2+2?",
		Stream:  boolPtr(false),
		Options: map[string]any{"temperature": 0.0, "num_predict": 32},
	}, func(api.GenerateResponse) error { return nil })
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, "text_completion.llama3.2", span.Name())
	assert.Equal(t, semconv.GenAIOperationNameTextCompletion.Value, attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("llama3.2"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.IntValue(32), attrs[semconv.GenAIRequestMaxTokensKey])
	assert.Equal(t, attribute.StringValue("llama3.2"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])
	assert.Equal(t, attribute.IntValue(8), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(5), attrs[semconv.GenAIUsageOutputTokensKey])

	// The /generate prompt is a bare arbitrary string → stays on langwatch.input text.
	inputTV := parseTypedValue(t, attrs[inputKey].AsString())
	assert.Equal(t, "text", inputTV.Type)
	assert.JSONEq(t, `"what is 2+2?"`, string(inputTV.Value))

	// The model's answer is an assistant message → gen_ai.output.messages, not langwatch.output.
	assert.NotContains(t, attrs, outputKey, "generate answer must not be on langwatch.output")
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, "assistant", outMsgs[0].Role)
	assert.Equal(t, "the answer is 4", outMsgs[0].Content)
}

func TestGenerate_Streaming(t *testing.T) {
	const streamBody = `{"model":"llama3.2","response":"hel","done":false}
{"model":"llama3.2","response":"lo","done":false}
{"model":"llama3.2","response":"","done":true,"done_reason":"length","prompt_eval_count":3,"eval_count":2}
`

	rt := &mockRoundTripper{statusCode: 200, respBody: streamBody, contentType: "application/x-ndjson"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	err := client.Generate(context.Background(), &api.GenerateRequest{
		Model:  "llama3.2",
		Prompt: "say hello",
	}, func(api.GenerateResponse) error { return nil })
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, attribute.BoolValue(true), attrs[attribute.Key("gen_ai.request.stream")])
	assert.Equal(t, attribute.StringSliceValue([]string{"length"}), attrs[semconv.GenAIResponseFinishReasonsKey])
	assert.Equal(t, attribute.IntValue(3), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageOutputTokensKey])

	// The streamed answer is an assistant message → gen_ai.output.messages.
	assert.NotContains(t, attrs, outputKey, "generate answer must not be on langwatch.output")
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, "assistant", outMsgs[0].Role)
	assert.Equal(t, "hello", outMsgs[0].Content)
}

func TestEmbed_NonStreaming(t *testing.T) {
	const respBody = `{"model":"all-minilm","embeddings":[[0.1,0.2,0.3],[0.4,0.5,0.6]],"total_duration":1000000000,"prompt_eval_count":6}`

	rt := &mockRoundTripper{statusCode: 200, respBody: respBody, contentType: "application/json"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	_, err := client.Embed(context.Background(), &api.EmbedRequest{
		Model:      "all-minilm",
		Input:      "embed me",
		Dimensions: 256,
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, "embeddings.all-minilm", span.Name())
	assert.Equal(t, attribute.StringValue("embeddings"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("all-minilm"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.StringValue("all-minilm"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.IntValue(256), attrs[semconv.GenAIEmbeddingsDimensionCountKey])

	// prompt_eval_count → input tokens; embeddings have no output tokens.
	assert.Equal(t, attribute.IntValue(6), attrs[semconv.GenAIUsageInputTokensKey])
	assert.NotContains(t, attrs, semconv.GenAIUsageOutputTokensKey)

	// Embeddings never stream.
	assert.Equal(t, attribute.BoolValue(false), attrs[attribute.Key("gen_ai.request.stream")])

	// Input recorded; output records only the vector count.
	inputTV := parseTypedValue(t, attrs[inputKey].AsString())
	assert.Equal(t, "text", inputTV.Type)
	assert.Equal(t, attribute.IntValue(2), attrs[attribute.Key("gen_ai.response.embeddings_count")])
}

func TestEmbeddings_Legacy_NonStreaming(t *testing.T) {
	// The legacy /api/embeddings endpoint returns a bare embedding[] with no
	// model and no usage.
	const respBody = `{"embedding":[0.1,0.2,0.3,0.4]}`

	rt := &mockRoundTripper{statusCode: 200, respBody: respBody, contentType: "application/json"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	_, err := client.Embeddings(context.Background(), &api.EmbeddingRequest{
		Model:  "all-minilm",
		Prompt: "embed me",
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, "embeddings.all-minilm", span.Name())
	assert.Equal(t, attribute.StringValue("embeddings"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("all-minilm"), attrs[semconv.GenAIRequestModelKey])
	// No usage tokens for the legacy endpoint.
	assert.NotContains(t, attrs, semconv.GenAIUsageInputTokensKey)

	// The legacy prompt is recorded as input text; one vector counted.
	inputTV := parseTypedValue(t, attrs[inputKey].AsString())
	assert.Equal(t, "text", inputTV.Type)
	assert.Equal(t, attribute.IntValue(1), attrs[attribute.Key("gen_ai.response.embeddings_count")])
}

func TestDataCapture_Gating(t *testing.T) {
	const respBody = `{"model":"llama3.2","message":{"role":"assistant","content":"pong"},"done":true,"done_reason":"stop","prompt_eval_count":2,"eval_count":1}`

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
			rt := &mockRoundTripper{statusCode: 200, respBody: respBody, contentType: "application/json"}
			provider, exporter := newTestProvider(t)
			client := newTracedClient(t, rt, WithTracerProvider(provider), WithDataCapture(tc.mode))

			err := client.Chat(context.Background(), &api.ChatRequest{
				Model:    "llama3.2",
				Stream:   boolPtr(false),
				Messages: []api.Message{{Role: "user", Content: "ping"}},
			}, func(api.ChatResponse) error { return nil })
			require.NoError(t, err)

			span := requireSingleSpan(t, provider, exporter)
			attrs := spanAttrs(span)

			// Chat messages are recorded gen_ai-native; gating governs the gen_ai keys.
			_, hasInput := attrs[genAIInputKey]
			_, hasOutput := attrs[genAIOutputKey]
			assert.Equal(t, tc.expectInput, hasInput, "input capture")
			assert.Equal(t, tc.expectOutput, hasOutput, "output capture")

			// Chat content never lands on langwatch.input/output, in any mode.
			assert.NotContains(t, attrs, inputKey, "chat input must not be on langwatch.input")
			assert.NotContains(t, attrs, outputKey, "chat output must not be on langwatch.output")

			// Usage always recorded regardless of capture mode.
			assert.Equal(t, attribute.IntValue(2), attrs[semconv.GenAIUsageInputTokensKey])
			assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageOutputTokensKey])
		})
	}
}

func TestDataCapture_None_GatesStreaming(t *testing.T) {
	const streamBody = `{"model":"llama3.2","message":{"role":"assistant","content":"secret"},"done":false}
{"model":"llama3.2","message":{"role":"assistant","content":""},"done":true,"done_reason":"stop","prompt_eval_count":1,"eval_count":1}
`

	rt := &mockRoundTripper{statusCode: 200, respBody: streamBody, contentType: "application/x-ndjson"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider), WithDataCapture(langwatch.DataCaptureNone))

	err := client.Chat(context.Background(), &api.ChatRequest{
		Model:    "llama3.2",
		Messages: []api.Message{{Role: "user", Content: "ping"}},
	}, func(api.ChatResponse) error { return nil })
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Content gated, but usage + finish reason still recorded. Chat messages are
	// gen_ai-native, so both the gen_ai keys and langwatch.input/output stay absent.
	assert.NotContains(t, attrs, genAIInputKey, "gen_ai input gated under DataCaptureNone")
	assert.NotContains(t, attrs, genAIOutputKey, "gen_ai output gated under DataCaptureNone")
	assert.NotContains(t, attrs, inputKey, "input gated under DataCaptureNone")
	assert.NotContains(t, attrs, outputKey, "output gated under DataCaptureNone")
	assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"stop"}), attrs[semconv.GenAIResponseFinishReasonsKey])
}

func TestWithGenAIProvider_OverridesDefault(t *testing.T) {
	const respBody = `{"model":"llama3.2","message":{"role":"assistant","content":"hola"},"done":true,"done_reason":"stop","prompt_eval_count":2,"eval_count":1}`

	custom := semconv.GenAIProviderNameKey.String("my-ollama-proxy")

	rt := &mockRoundTripper{statusCode: 200, respBody: respBody, contentType: "application/json"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider), WithGenAIProvider(custom))

	err := client.Chat(context.Background(), &api.ChatRequest{
		Model:    "llama3.2",
		Stream:   boolPtr(false),
		Messages: []api.Message{{Role: "user", Content: "hi"}},
	}, func(api.ChatResponse) error { return nil })
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Equal(t, custom.Value, attrs[semconv.GenAIProviderNameKey])
	assert.Equal(t, "chat.llama3.2", span.Name())
}

func TestAPIError(t *testing.T) {
	rt := &mockRoundTripper{
		statusCode:  400,
		respBody:    `{"error":"model 'nope' not found"}`,
		contentType: "application/json",
	}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	err := client.Chat(context.Background(), &api.ChatRequest{
		Model:    "nope",
		Stream:   boolPtr(false),
		Messages: []api.Message{{Role: "user", Content: "ping"}},
	}, func(api.ChatResponse) error { return nil })
	require.Error(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Equal(t, codes.Error, span.Status().Code)
	assert.Equal(t, attribute.IntValue(400), attrs[semconv.HTTPResponseStatusCodeKey])
}

func TestNewHTTPClient_DirectWiring(t *testing.T) {
	const respBody = `{"model":"llama3.2","message":{"role":"assistant","content":"pong"},"done":true,"prompt_eval_count":2,"eval_count":1}`

	rt := &mockRoundTripper{statusCode: 200, respBody: respBody, contentType: "application/json"}
	provider, exporter := newTestProvider(t)

	// NewHTTPClient wires http.DefaultTransport; here we route through the mock by
	// composing the transport directly, exercising the public NewHTTPClient shape.
	httpClient := NewHTTPClient(WithTracerProvider(provider))
	httpClient.Transport = NewTransportWithBase(rt, WithTracerProvider(provider))
	base, err := url.Parse("http://localhost:11434")
	require.NoError(t, err)
	client := api.NewClient(base, httpClient)

	err = client.Chat(context.Background(), &api.ChatRequest{
		Model:    "llama3.2",
		Stream:   boolPtr(false),
		Messages: []api.Message{{Role: "user", Content: "ping"}},
	}, func(api.ChatResponse) error { return nil })
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	assert.Equal(t, codes.Ok, span.Status().Code)
	assert.Equal(t, attribute.IntValue(2), spanAttrs(span)[semconv.GenAIUsageInputTokensKey])
}

func TestGenAIOperationFromPath(t *testing.T) {
	tests := []struct {
		path     string
		expected attribute.KeyValue
	}{
		{"/api/chat", semconv.GenAIOperationNameChat},
		{"/api/generate", semconv.GenAIOperationNameTextCompletion},
		{"/api/embed", semconv.GenAIOperationNameEmbeddings},
		{"/api/embeddings", semconv.GenAIOperationNameEmbeddings},
		{"/api/unknown", semconv.GenAIOperationNameKey.String("unknown")},
		{"", semconv.GenAIOperationNameChat},
	}

	for _, test := range tests {
		t.Run(test.path, func(t *testing.T) {
			result := genAIOperationFromPath(test.path)
			if result.Key != test.expected.Key || result.Value.AsString() != test.expected.Value.AsString() {
				t.Errorf("Expected %v, got %v", test.expected, result)
			}
		})
	}
}

// jsonEqRaw is a small guard that the request body we send round-trips as valid
// JSON the extractor can parse — a sanity check on the mock capture path.
func TestRequestBodyCaptured(t *testing.T) {
	const respBody = `{"model":"llama3.2","message":{"role":"assistant","content":"ok"},"done":true,"prompt_eval_count":1,"eval_count":1}`

	rt := &mockRoundTripper{statusCode: 200, respBody: respBody, contentType: "application/json"}
	provider, _ := newTestProvider(t)
	client := newTracedClient(t, rt, WithTracerProvider(provider))

	err := client.Chat(context.Background(), &api.ChatRequest{
		Model:    "llama3.2",
		Stream:   boolPtr(false),
		Messages: []api.Message{{Role: "user", Content: "ping"}},
	}, func(api.ChatResponse) error { return nil })
	require.NoError(t, err)

	var sent map[string]any
	require.NoError(t, json.Unmarshal(rt.capturedReq, &sent), "captured request body must be valid JSON")
	assert.Equal(t, "llama3.2", sent["model"])
}
