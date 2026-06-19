package gopenai

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	openai "github.com/sashabaranov/go-openai"
)

// toolCallMessages parses the gen_ai.output.messages attribute into LangWatch
// messages for the tool-call assertions. Chat-completion message output (with its
// tool calls) is recorded in the gen_ai-native format, not under langwatch.output.
func toolCallMessages(t *testing.T, span sdktrace.ReadOnlySpan) []langwatch.ChatMessage {
	t.Helper()
	attrs := spanAttrs(span)
	require.Contains(t, attrs, genAIOutputKey, "tool-calling response must record gen_ai.output.messages")
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.NotContains(t, attrs, outputKey, "tool-calling chat output must not be recorded under langwatch.output")
	return msgs
}

// TestChatCompletion_NonStreaming_ToolCalls verifies a tool-calling response is
// recorded as chat_messages output carrying the tool call, not dropped as text.
func TestChatCompletion_NonStreaming_ToolCalls(t *testing.T) {
	const respBody = `{"id":"cmpl-tool","object":"chat.completion","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"get_time","arguments":"{\"tz\":\"UTC\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":4,"completion_tokens":6,"total_tokens":10}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(rt, WithTracerProvider(provider))

	_, err := client.CreateChatCompletion(context.Background(), openai.ChatCompletionRequest{
		Model:    openai.GPT4oMini,
		Messages: []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "what time is it?"}},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	msgs := toolCallMessages(t, span)
	require.Len(t, msgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, msgs[0].Role)
	require.Len(t, msgs[0].ToolCalls, 1, "the tool call must be captured, not dropped")
	tc := msgs[0].ToolCalls[0]
	assert.Equal(t, "call_1", tc.ID)
	assert.Equal(t, "function", tc.Type)
	assert.Equal(t, "get_time", tc.Function.Name)
	assert.JSONEq(t, `{"tz":"UTC"}`, tc.Function.Arguments)
}

// TestChatCompletion_Streaming_ToolCalls verifies a streamed tool call (whose
// arguments arrive incrementally) is reassembled into chat_messages output.
func TestChatCompletion_Streaming_ToolCalls(t *testing.T) {
	const streamBody = `data: {"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_s","type":"function","function":{"name":"add","arguments":""}}]},"finish_reason":null}]}

data: {"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"a\":1,"}}]},"finish_reason":null}]}

data: {"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\"b\":2}"}}]},"finish_reason":"tool_calls"}]}

data: {"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":6,"total_tokens":10}}

data: [DONE]

`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: streamBody, contentType: "text/event-stream"}
	provider, exporter := newTestProvider(t)
	client := newTracedClient(rt, WithTracerProvider(provider))

	stream, err := client.CreateChatCompletionStream(context.Background(), openai.ChatCompletionRequest{
		Model:         openai.GPT4oMini,
		Messages:      []openai.ChatCompletionMessage{{Role: openai.ChatMessageRoleUser, Content: "add 1 and 2"}},
		StreamOptions: &openai.StreamOptions{IncludeUsage: true},
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
	msgs := toolCallMessages(t, span)
	require.Len(t, msgs, 1)
	require.Len(t, msgs[0].ToolCalls, 1, "streamed tool call must be reassembled, not dropped")
	tc := msgs[0].ToolCalls[0]
	assert.Equal(t, "call_s", tc.ID)
	assert.Equal(t, "add", tc.Function.Name)
	assert.JSONEq(t, `{"a":1,"b":2}`, tc.Function.Arguments, "incremental argument fragments are reassembled")
}
