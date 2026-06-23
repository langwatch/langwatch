package openai

import (
	"context"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"

	langwatch "github.com/langwatch/langwatch/sdk-go"
	openai "github.com/openai/openai-go/v3"
	"github.com/openai/openai-go/v3/option"
	"github.com/openai/openai-go/v3/responses"
)

// TestMiddleware_ChatCompletion_NonStreaming_ToolCalls verifies a tool-calling
// chat response is recorded as gen_ai output messages carrying the tool call,
// rather than being discarded as empty text.
func TestMiddleware_ChatCompletion_NonStreaming_ToolCalls(t *testing.T) {
	const respBody = `{"id":"cmpl-tool","object":"chat.completion","created":1700000000,"model":"gpt-4o-mini","choices":[{"index":0,"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_abc","type":"function","function":{"name":"get_weather","arguments":"{\"city\":\"Paris\"}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":5,"completion_tokens":8,"total_tokens":13}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Chat.Completions.New(context.Background(), openai.ChatCompletionNewParams{
		Model:    openai.ChatModelGPT4oMini,
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("weather in Paris?")},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	require.Contains(t, attrs, genAIOutputKey, "tool-calling response must record output")
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, msgs[0].Role)
	require.Len(t, msgs[0].ToolCalls, 1, "the tool call must be captured, not dropped")
	tc := msgs[0].ToolCalls[0]
	assert.Equal(t, "call_abc", tc.ID)
	assert.Equal(t, "function", tc.Type)
	assert.Equal(t, "get_weather", tc.Function.Name)
	assert.JSONEq(t, `{"city":"Paris"}`, tc.Function.Arguments)
	assert.NotContains(t, attrs, outputKey, "chat output is under gen_ai, not langwatch.output")
}

// TestMiddleware_ChatCompletion_Streaming_ToolCalls verifies a streamed
// tool-call (whose arguments arrive incrementally) is reassembled and recorded
// as gen_ai output messages carrying the tool call.
func TestMiddleware_ChatCompletion_Streaming_ToolCalls(t *testing.T) {
	const streamBody = `data: {"id":"cmpl-str-tool","object":"chat.completion.chunk","created":1,"model":"gpt-4o-mini","choices":[{"index":0,"delta":{"role":"assistant","tool_calls":[{"index":0,"id":"call_str","type":"function","function":{"name":"lookup","arguments":""}}]},"finish_reason":null}]}

data: {"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"q\":"}}]},"finish_reason":null}]}

data: {"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"42}"}}]},"finish_reason":"tool_calls"}]}

data: {"id":"cmpl-str-tool","object":"chat.completion.chunk","model":"gpt-4o-mini","choices":[],"usage":{"prompt_tokens":4,"completion_tokens":6,"total_tokens":10}}

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
		Messages: []openai.ChatCompletionMessageParamUnion{openai.UserMessage("call a tool")},
	})
	for stream.Next() {
		_ = stream.Current()
	}
	require.NoError(t, stream.Err())

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	require.Contains(t, attrs, genAIOutputKey, "streamed tool call must record output")
	msgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, msgs, 1)
	require.Len(t, msgs[0].ToolCalls, 1, "streamed tool call must be reassembled, not dropped")
	tc := msgs[0].ToolCalls[0]
	assert.Equal(t, "call_str", tc.ID)
	assert.Equal(t, "lookup", tc.Function.Name)
	assert.JSONEq(t, `{"q":42}`, tc.Function.Arguments, "incremental argument fragments are reassembled")
	assert.NotContains(t, attrs, outputKey, "chat output is under gen_ai, not langwatch.output")
}

// TestMiddleware_Responses_NonStreaming_ToolCalls verifies a Responses
// function-call output item is recorded as gen_ai output messages (the call is
// not discarded by OutputText(), which only returns message text).
func TestMiddleware_Responses_NonStreaming_ToolCalls(t *testing.T) {
	const respBody = `{"id":"resp_tool","object":"response","model":"gpt-4o","status":"completed","output":[{"type":"function_call","call_id":"fc_1","name":"search","arguments":"{\"term\":\"go\"}"}],"usage":{"input_tokens":9,"output_tokens":5,"total_tokens":14}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model: openai.ChatModelGPT4oMini,
		Input: responses.ResponseNewParamsInputUnion{OfString: openai.Opt("search for go")},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	require.Contains(t, attrs, genAIOutputKey, "function-call response must record output")
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
	assert.NotContains(t, attrs, outputKey, "chat output is under gen_ai, not langwatch.output")
}

// TestMiddleware_Responses_ToolChoiceAbsentWhenUnset verifies the
// gen_ai.request.tool_choice attribute is NOT recorded when the user did not set
// tool_choice (its typed zero value otherwise marshals to a bogus value).
func TestMiddleware_Responses_ToolChoiceAbsentWhenUnset(t *testing.T) {
	const respBody = `{"id":"resp_no_tc","object":"response","model":"gpt-4o","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"hi"}]}],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model: openai.ChatModelGPT4oMini,
		Input: responses.ResponseNewParamsInputUnion{OfString: openai.Opt("hi")},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	_, present := attrs[attribute.Key("gen_ai.request.tool_choice")]
	assert.False(t, present, "tool_choice must be absent when the user did not set it")
}

// TestMiddleware_Responses_ToolChoiceRecordedWhenSet verifies tool_choice IS
// recorded when the user sets it (the guard must not over-suppress).
func TestMiddleware_Responses_ToolChoiceRecordedWhenSet(t *testing.T) {
	const respBody = `{"id":"resp_tc","object":"response","model":"gpt-4o","status":"completed","output":[],"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}`

	rt := &mockRoundTripper{statusCode: http.StatusOK, respBody: respBody}
	provider, exporter := newTestProvider(t)
	client := openai.NewClient(
		option.WithAPIKey("dummy-key"),
		option.WithHTTPClient(newMockClient(rt)),
		option.WithMiddleware(Middleware("test-client", WithTracerProvider(provider))),
	)

	_, err := client.Responses.New(context.Background(), responses.ResponseNewParams{
		Model:      openai.ChatModelGPT4oMini,
		Input:      responses.ResponseNewParamsInputUnion{OfString: openai.Opt("hi")},
		ToolChoice: responses.ResponseNewParamsToolChoiceUnion{OfToolChoiceMode: openai.Opt(responses.ToolChoiceOptionsAuto)},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	tc, present := attrs[attribute.Key("gen_ai.request.tool_choice")]
	require.True(t, present, "tool_choice must be recorded when the user set it")
	assert.Contains(t, tc.AsString(), "auto")
}
