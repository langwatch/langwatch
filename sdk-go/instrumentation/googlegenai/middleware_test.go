package googlegenai

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"google.golang.org/genai"
)

func TestGenerateContent_NonStreaming(t *testing.T) {
	const respBody = `{
		"candidates": [
			{
				"content": {"parts": [{"text": "Ahoy there!"}], "role": "model"},
				"finishReason": "STOP",
				"index": 0
			}
		],
		"modelVersion": "gemini-2.5-flash-001",
		"responseId": "resp-abc",
		"usageMetadata": {
			"promptTokenCount": 11,
			"candidatesTokenCount": 7,
			"totalTokenCount": 21,
			"cachedContentTokenCount": 4,
			"thoughtsTokenCount": 3
		}
	}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)

	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:     "test-key",
		HTTPClient: tracedClient(rt, provider),
		Backend:    genai.BackendGeminiAPI,
	})
	require.NoError(t, err)

	resp, err := client.Models.GenerateContent(
		context.Background(),
		"gemini-2.5-flash",
		genai.Text("Hello, Gemini!"),
		&genai.GenerateContentConfig{
			Temperature:       genai.Ptr[float32](0.7),
			TopP:              genai.Ptr[float32](0.9),
			TopK:              genai.Ptr[float32](40),
			MaxOutputTokens:   256,
			CandidateCount:    1,
			StopSequences:     []string{"END"},
			SystemInstruction: genai.NewContentFromText("You are a helpful pirate.", genai.RoleUser),
		},
	)
	require.NoError(t, err)
	require.Equal(t, "Ahoy there!", resp.Text())

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// The request model and operation come from the URL path, not the body.
	assert.Equal(t, codes.Ok, span.Status().Code)
	assert.Equal(t, attribute.StringValue("gemini-2.5-flash"), attrs[semconv.GenAIRequestModelKey],
		"request model is parsed from the URL path")
	assert.Equal(t, attribute.StringValue("generate_content"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("gcp.gemini"), attrs[semconv.GenAIProviderNameKey])

	// Request params come from generationConfig.
	assert.Equal(t, attribute.Float64Value(0.7), attrs[semconv.GenAIRequestTemperatureKey])
	assert.Equal(t, attribute.Float64Value(0.9), attrs[semconv.GenAIRequestTopPKey])
	assert.Equal(t, attribute.Float64Value(40), attrs[semconv.GenAIRequestTopKKey])
	assert.Equal(t, attribute.IntValue(256), attrs[semconv.GenAIRequestMaxTokensKey])
	assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIRequestChoiceCountKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"END"}), attrs[semconv.GenAIRequestStopSequencesKey])

	// Response model + id.
	assert.Equal(t, attribute.StringValue("gemini-2.5-flash-001"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("resp-abc"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"STOP"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// ALL usage from usageMetadata, via gen_ai.usage.* attributes.
	assert.Equal(t, attribute.IntValue(11), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(7), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(21), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(4), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	assert.Equal(t, attribute.IntValue(3), attrs[attribute.Key("gen_ai.usage.reasoning.output_tokens")])

	// A non-streaming request records gen_ai.request.stream == false and no TTFT.
	assert.Equal(t, attribute.BoolValue(false), attrs[attribute.Key("gen_ai.request.stream")])
	assert.NotContains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"))

	// The same usage is also recorded as langwatch.metrics.
	metrics := spanMetrics(t, attrs[langwatch.AttributeLangWatchMetrics].AsString())
	require.NotNil(t, metrics.PromptTokens)
	assert.Equal(t, 11, *metrics.PromptTokens)
	require.NotNil(t, metrics.CompletionTokens)
	assert.Equal(t, 7, *metrics.CompletionTokens)
	require.NotNil(t, metrics.ReasoningTokens)
	assert.Equal(t, 3, *metrics.ReasoningTokens)
	require.NotNil(t, metrics.CacheReadInputTokens)
	assert.Equal(t, 4, *metrics.CacheReadInputTokens)

	// System instruction recorded under the gen_ai-native key (default capture
	// mode is All) — NOT under the langwatch.instructions mirror, which is gone.
	assert.Equal(t, "You are a helpful pirate.", attrs[genAIInstructionsKey].AsString())
	_, hasInstrMirror := attrs[langwatch.AttributeLangWatchInstructions]
	assert.False(t, hasInstrMirror, "system instructions must NOT be mirrored to langwatch.instructions")

	// Input recorded as gen_ai.input.messages (user role); output as
	// gen_ai.output.messages (assistant role) — NOT under langwatch.input/output.
	inputMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inputMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleUser, inputMsgs[0].Role)
	assert.Equal(t, "Hello, Gemini!", inputMsgs[0].Content)

	outputMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outputMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outputMsgs[0].Role)
	assert.Equal(t, "Ahoy there!", outputMsgs[0].Content)

	// Chat I/O is NOT recorded under the langwatch.input/output envelope.
	_, hasLangWatchInput := attrs[inputKey]
	assert.False(t, hasLangWatchInput, "chat input must NOT be recorded under langwatch.input")
	_, hasLangWatchOutput := attrs[outputKey]
	assert.False(t, hasLangWatchOutput, "chat output must NOT be recorded under langwatch.output")
}

func TestGenerateContent_Streaming(t *testing.T) {
	// Gemini SSE: one GenerateContentResponse per `data:` line, NO [DONE]
	// sentinel; the final chunk carries usageMetadata + finishReason + modelVersion.
	const streamBody = `data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},"index":0}],"modelVersion":"gemini-2.5-flash-001","responseId":"stream-1"}

data: {"candidates":[{"content":{"parts":[{"text":" world"}],"role":"model"},"index":0}],"modelVersion":"gemini-2.5-flash-001"}

data: {"candidates":[{"content":{"parts":[{"text":"!"}],"role":"model"},"finishReason":"STOP","index":0}],"modelVersion":"gemini-2.5-flash-001","usageMetadata":{"promptTokenCount":5,"candidatesTokenCount":3,"totalTokenCount":8,"thoughtsTokenCount":2}}

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)

	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:     "test-key",
		HTTPClient: tracedClient(rt, provider),
		Backend:    genai.BackendGeminiAPI,
	})
	require.NoError(t, err)

	var got string
	for chunk, err := range client.Models.GenerateContentStream(
		context.Background(),
		"gemini-2.5-flash",
		genai.Text("count"),
		nil,
	) {
		require.NoError(t, err)
		got += chunk.Text()
	}
	assert.Equal(t, "Hello world!", got, "stream yields the full text across chunks")

	// The traced request hit the streaming action.
	assert.Contains(t, rt.capturedPath, ":streamGenerateContent")

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, attribute.StringValue("gemini-2.5-flash"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.StringValue("generate_content"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("gemini-2.5-flash-001"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.StringValue("stream-1"), attrs[semconv.GenAIResponseIDKey])
	assert.Equal(t, attribute.StringSliceValue([]string{"STOP"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// A streaming request records gen_ai.request.stream == true and a TTFT, even
	// though Gemini signals streaming via the URL action, not a body field.
	assert.Equal(t, attribute.BoolValue(true), attrs[attribute.Key("gen_ai.request.stream")])
	require.Contains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"), "streaming must record TTFT")
	assert.GreaterOrEqual(t, attrs[attribute.Key("gen_ai.response.time_to_first_chunk")].AsFloat64(), 0.0)

	// Usage arrives in the final chunk.
	assert.Equal(t, attribute.IntValue(5), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(3), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(8), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(2), attrs[attribute.Key("gen_ai.usage.reasoning.output_tokens")])

	// Accumulated streamed text is recorded as gen_ai.output.messages (assistant
	// role), NOT under langwatch.output.
	outputMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outputMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outputMsgs[0].Role)
	assert.Equal(t, "Hello world!", outputMsgs[0].Content)
	_, hasLangWatchOutput := attrs[outputKey]
	assert.False(t, hasLangWatchOutput, "streamed chat output must NOT be recorded under langwatch.output")
}

func TestGenerateContent_DataCaptureNone(t *testing.T) {
	const respBody = `{"candidates":[{"content":{"parts":[{"text":"secret answer"}],"role":"model"},"finishReason":"STOP"}],"modelVersion":"gemini-2.5-flash-001","usageMetadata":{"promptTokenCount":9,"candidatesTokenCount":4,"totalTokenCount":13}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)

	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:     "test-key",
		HTTPClient: tracedClient(rt, provider, WithDataCapture(langwatch.DataCaptureNone)),
		Backend:    genai.BackendGeminiAPI,
	})
	require.NoError(t, err)

	_, err = client.Models.GenerateContent(
		context.Background(),
		"gemini-2.5-flash",
		genai.Text("sensitive prompt"),
		&genai.GenerateContentConfig{
			SystemInstruction: genai.NewContentFromText("secret system instruction", genai.RoleUser),
		},
	)
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Structure, model, usage and finish reasons are still recorded.
	assert.Equal(t, attribute.StringValue("gemini-2.5-flash"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.StringValue("gemini-2.5-flash-001"), attrs[semconv.GenAIResponseModelKey])
	assert.Equal(t, attribute.IntValue(9), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(4), attrs[semconv.GenAIUsageOutputTokensKey])

	// But NO content: input, output and system instructions are all withheld —
	// under both the gen_ai-native keys (where content now lives) and the legacy
	// langwatch.* keys.
	_, hasGenAIInput := attrs[genAIInputKey]
	assert.False(t, hasGenAIInput, "gen_ai.input.messages withheld under DataCaptureNone")
	_, hasGenAIOutput := attrs[genAIOutputKey]
	assert.False(t, hasGenAIOutput, "gen_ai.output.messages withheld under DataCaptureNone")
	_, hasInstr := attrs[genAIInstructionsKey]
	assert.False(t, hasInstr, "gen_ai.system_instructions withheld under DataCaptureNone")
	_, hasInput := attrs[inputKey]
	assert.False(t, hasInput, "langwatch.input withheld under DataCaptureNone")
	_, hasOutput := attrs[outputKey]
	assert.False(t, hasOutput, "langwatch.output withheld under DataCaptureNone")
}

func TestGenerateContent_ErrorResponse(t *testing.T) {
	const errBody = `{"error":{"code":429,"message":"Resource has been exhausted","status":"RESOURCE_EXHAUSTED"}}`

	rt := &mockRoundTripper{statusCode: http.StatusTooManyRequests, respBody: errBody}
	provider, exporter := newTestProvider(t)

	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:     "test-key",
		HTTPClient: tracedClient(rt, provider),
		Backend:    genai.BackendGeminiAPI,
	})
	require.NoError(t, err)

	_, err = client.Models.GenerateContent(context.Background(), "gemini-2.5-flash", genai.Text("hi"), nil)
	require.Error(t, err, "genai surfaces the HTTP 429 as an error")

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Equal(t, codes.Error, span.Status().Code)
	assert.Equal(t, int64(429), attrs[semconv.HTTPResponseStatusCodeKey].AsInt64())
	// The request model is still captured from the path even on error.
	assert.Equal(t, attribute.StringValue("gemini-2.5-flash"), attrs[semconv.GenAIRequestModelKey])
}
