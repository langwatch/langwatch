package googlegenai

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	"google.golang.org/genai"
)

// toolCallMessages parses the gen_ai.output.messages attribute into LangWatch
// messages for the function-call assertions. Output messages are recorded under
// the gen_ai-native key as a raw JSON array, NOT under langwatch.output.
func toolCallMessages(t *testing.T, span sdktrace.ReadOnlySpan) []langwatch.ChatMessage {
	t.Helper()
	attrs := spanAttrs(span)
	require.Contains(t, attrs, genAIOutputKey, "function-call response must record gen_ai.output.messages")
	_, onLangWatchOutput := attrs[outputKey]
	require.False(t, onLangWatchOutput, "chat output must NOT be recorded under langwatch.output")
	return genAIMessages(t, attrs[genAIOutputKey].AsString())
}

// TestGenerateContent_NonStreaming_FunctionCall verifies a functionCall response
// part is recorded as chat_messages output carrying the tool call, not dropped.
func TestGenerateContent_NonStreaming_FunctionCall(t *testing.T) {
	const respBody = `{
		"candidates": [
			{
				"content": {"parts": [{"functionCall": {"id": "fc_1", "name": "get_weather", "args": {"city": "Paris"}}}], "role": "model"},
				"finishReason": "STOP",
				"index": 0
			}
		],
		"modelVersion": "gemini-2.5-flash-001",
		"responseId": "resp-fc",
		"usageMetadata": {"promptTokenCount": 9, "candidatesTokenCount": 5, "totalTokenCount": 14}
	}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)

	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:     "test-key",
		HTTPClient: tracedClient(rt, provider),
		Backend:    genai.BackendGeminiAPI,
	})
	require.NoError(t, err)

	_, err = client.Models.GenerateContent(
		context.Background(),
		"gemini-2.5-flash",
		genai.Text("weather in Paris?"),
		nil,
	)
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	msgs := toolCallMessages(t, span)
	require.Len(t, msgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, msgs[0].Role)
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok, "content should be rich parts, got %T", msgs[0].Content)
	require.Len(t, parts, 1)
	toolPart := parts[0].(map[string]any)
	assert.Equal(t, "tool_call", toolPart["type"])
	assert.Equal(t, "get_weather", toolPart["toolName"])
	assert.Equal(t, "fc_1", toolPart["toolCallId"])
	assert.JSONEq(t, `{"city":"Paris"}`, toolPart["args"].(string))
}

// TestGenerateContent_NonStreaming_TextThenFunctionCall verifies a response
// mixing visible text and a functionCall records both: a text part followed by a
// tool_call part.
func TestGenerateContent_NonStreaming_TextThenFunctionCall(t *testing.T) {
	const respBody = `{
		"candidates": [
			{
				"content": {"parts": [{"text": "Let me check. "}, {"functionCall": {"name": "lookup", "args": {"q": "go"}}}], "role": "model"},
				"finishReason": "STOP",
				"index": 0
			}
		],
		"modelVersion": "gemini-2.5-flash-001",
		"responseId": "resp-mix"
	}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)

	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:     "test-key",
		HTTPClient: tracedClient(rt, provider),
		Backend:    genai.BackendGeminiAPI,
	})
	require.NoError(t, err)

	_, err = client.Models.GenerateContent(context.Background(), "gemini-2.5-flash", genai.Text("look up go"), nil)
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	msgs := toolCallMessages(t, span)
	require.Len(t, msgs, 1)
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok)
	require.Len(t, parts, 2, "text part followed by the tool_call part")
	assert.Equal(t, "text", parts[0].(map[string]any)["type"])
	assert.Equal(t, "Let me check. ", parts[0].(map[string]any)["text"])
	assert.Equal(t, "tool_call", parts[1].(map[string]any)["type"])
	assert.Equal(t, "lookup", parts[1].(map[string]any)["toolName"])
}

// TestGenerateContent_Streaming_FunctionCall verifies a functionCall streamed in
// a chunk is recorded as chat_messages output carrying the tool call.
func TestGenerateContent_Streaming_FunctionCall(t *testing.T) {
	const streamBody = `data: {"candidates":[{"content":{"parts":[{"text":"Working"}],"role":"model"},"index":0}],"modelVersion":"gemini-2.5-flash-001","responseId":"stream-fc"}

data: {"candidates":[{"content":{"parts":[{"functionCall":{"id":"fc_s","name":"add","args":{"a":1,"b":2}}}],"role":"model"},"finishReason":"STOP","index":0}],"modelVersion":"gemini-2.5-flash-001","usageMetadata":{"promptTokenCount":4,"candidatesTokenCount":6,"totalTokenCount":10}}

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)

	client, err := genai.NewClient(context.Background(), &genai.ClientConfig{
		APIKey:     "test-key",
		HTTPClient: tracedClient(rt, provider),
		Backend:    genai.BackendGeminiAPI,
	})
	require.NoError(t, err)

	for _, err := range client.Models.GenerateContentStream(context.Background(), "gemini-2.5-flash", genai.Text("add 1 and 2"), nil) {
		require.NoError(t, err)
	}

	span := requireSingleSpan(t, provider, exporter)
	msgs := toolCallMessages(t, span)
	require.Len(t, msgs, 1)
	parts, ok := msgs[0].Content.([]any)
	require.True(t, ok)
	// Visible text accumulated across chunks, then the streamed tool call.
	require.Len(t, parts, 2)
	assert.Equal(t, "text", parts[0].(map[string]any)["type"])
	assert.Equal(t, "Working", parts[0].(map[string]any)["text"])
	toolPart := parts[1].(map[string]any)
	assert.Equal(t, "tool_call", toolPart["type"])
	assert.Equal(t, "add", toolPart["toolName"])
	assert.Equal(t, "fc_s", toolPart["toolCallId"])
	assert.JSONEq(t, `{"a":1,"b":2}`, toolPart["args"].(string))
}
