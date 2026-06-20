package bedrock

import (
	"context"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/document"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// stubHTTPClient is an aws.HTTPClient returning a canned response and capturing
// the outgoing request body so tests can assert on what was serialised.
type stubHTTPClient struct {
	status      int
	body        string
	contentType string
	captured    []byte
}

func (s *stubHTTPClient) Do(req *http.Request) (*http.Response, error) {
	if req.Body != nil {
		s.captured, _ = io.ReadAll(req.Body)
	}
	ct := s.contentType
	if ct == "" {
		ct = "application/json"
	}
	header := http.Header{}
	header.Set("Content-Type", ct)
	return &http.Response{
		StatusCode: s.status,
		Body:       io.NopCloser(strings.NewReader(s.body)),
		Header:     header,
	}, nil
}

const converseRespBody = `{
  "output": {"message": {"role": "assistant", "content": [{"text": "pong"}]}},
  "stopReason": "end_turn",
  "usage": {"inputTokens": 12, "outputTokens": 7, "totalTokens": 19, "cacheReadInputTokens": 5, "cacheWriteInputTokens": 3},
  "metrics": {"latencyMs": 432}
}`

func TestConverse_RoundTrip_RecordsEverything(t *testing.T) {
	stub := &stubHTTPClient{status: http.StatusOK, body: converseRespBody}
	provider, exporter := newTestProvider(t)

	cfg := aws.Config{
		Region:      "us-east-1",
		Credentials: stubCredentials{},
		HTTPClient:  stub,
	}
	InstrumentConfig(&cfg, WithTracerProvider(provider))
	client := bedrockruntime.NewFromConfig(cfg)

	out, err := client.Converse(context.Background(), &bedrockruntime.ConverseInput{
		ModelId: aws.String("anthropic.claude-3-5-sonnet-20240620-v1:0"),
		Messages: []types.Message{{
			Role:    types.ConversationRoleUser,
			Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "ping"}},
		}},
		System: []types.SystemContentBlock{
			&types.SystemContentBlockMemberText{Value: "be terse"},
		},
		InferenceConfig: &types.InferenceConfiguration{
			MaxTokens:     aws.Int32(64),
			Temperature:   aws.Float32(0.7),
			TopP:          aws.Float32(0.9),
			StopSequences: []string{"STOP"},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, out)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Span identity.
	assert.Equal(t, "chat.anthropic.claude-3-5-sonnet-20240620-v1:0", span.Name())
	assert.Equal(t, codes.Ok, span.Status().Code)
	assert.Equal(t, attribute.StringValue("aws.bedrock"), attrs[semconv.GenAIProviderNameKey])
	assert.Equal(t, attribute.StringValue("chat"), attrs[semconv.GenAIOperationNameKey])
	assert.Equal(t, attribute.StringValue("llm"), attrs[langwatch.AttributeLangWatchSpanType])
	// A non-streaming (unary Converse) request records gen_ai.request.stream ==
	// false and no TTFT.
	assert.Equal(t, attribute.BoolValue(false), attrs[attribute.Key("gen_ai.request.stream")])
	assert.NotContains(t, attrs, attribute.Key("gen_ai.response.time_to_first_chunk"))

	// Request model + params.
	assert.Equal(t, attribute.StringValue("anthropic.claude-3-5-sonnet-20240620-v1:0"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.IntValue(64), attrs[semconv.GenAIRequestMaxTokensKey])
	// Temperature/TopP are float32 in the SDK, so the widened float64 carries
	// float32 precision (0.7 -> 0.69999998...).
	assert.InDelta(t, 0.7, attrs[semconv.GenAIRequestTemperatureKey].AsFloat64(), 1e-6)
	assert.InDelta(t, 0.9, attrs[semconv.GenAIRequestTopPKey].AsFloat64(), 1e-6)
	assert.Equal(t, attribute.StringSliceValue([]string{"STOP"}), attrs[semconv.GenAIRequestStopSequencesKey])

	// System instructions captured in the gen_ai-native attribute.
	assert.Equal(t, "be terse", attrs[genAISystemKey].AsString())

	// Response: stop reason + usage (all token types). Tokens flow solely through
	// gen_ai.usage.*: cache read -> cached_input_tokens, cache write ->
	// cache_creation.input_tokens.
	assert.Equal(t, attribute.StringSliceValue([]string{"end_turn"}), attrs[semconv.GenAIResponseFinishReasonsKey])
	assert.Equal(t, attribute.IntValue(12), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(7), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(19), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.IntValue(5), attrs[attribute.Key("gen_ai.usage.cached_input_tokens")])
	assert.Equal(t, attribute.IntValue(3), attrs[attribute.Key("gen_ai.usage.cache_creation.input_tokens")])

	// Input chat messages recorded in the gen_ai-native attribute.
	inMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleUser, inMsgs[0].Role)
	assert.Equal(t, "ping", inMsgs[0].Content)

	// Output chat messages recorded in the gen_ai-native attribute.
	outMsgs := genAIMessages(t, attrs[genAIOutputKey].AsString())
	require.Len(t, outMsgs, 1)
	assert.Equal(t, langwatch.ChatRoleAssistant, outMsgs[0].Role)
	assert.Equal(t, "pong", outMsgs[0].Content)

	// Chat I/O lives in gen_ai.*, NOT the langwatch.input/output envelope.
	_, hasLangWatchInput := attrs[inputKey]
	_, hasLangWatchOutput := attrs[outputKey]
	assert.False(t, hasLangWatchInput, "chat input must not be under langwatch.input")
	assert.False(t, hasLangWatchOutput, "chat output must not be under langwatch.output")
}

func TestConverse_RoundTrip_DataCaptureNone_StripsContent(t *testing.T) {
	stub := &stubHTTPClient{status: http.StatusOK, body: converseRespBody}
	provider, exporter := newTestProvider(t)

	cfg := aws.Config{Region: "us-east-1", Credentials: stubCredentials{}, HTTPClient: stub}
	InstrumentConfig(&cfg, WithTracerProvider(provider), WithDataCapture(langwatch.DataCaptureNone))
	client := bedrockruntime.NewFromConfig(cfg)

	_, err := client.Converse(context.Background(), &bedrockruntime.ConverseInput{
		ModelId:  aws.String("anthropic.claude-3-haiku-20240307-v1:0"),
		Messages: []types.Message{{Role: types.ConversationRoleUser, Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "secret"}}}},
		System:   []types.SystemContentBlock{&types.SystemContentBlockMemberText{Value: "secret instructions"}},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Content stripped at the source, under both the gen_ai-native keys and the
	// legacy langwatch.input/output envelope.
	_, hasGenAIInput := attrs[genAIInputKey]
	_, hasGenAIOutput := attrs[genAIOutputKey]
	_, hasInstructions := attrs[genAISystemKey]
	_, hasInput := attrs[inputKey]
	_, hasOutput := attrs[outputKey]
	assert.False(t, hasGenAIInput, "input content should not be recorded")
	assert.False(t, hasGenAIOutput, "output content should not be recorded")
	assert.False(t, hasInstructions, "system instructions should not be recorded")
	assert.False(t, hasInput, "input content should not be recorded under langwatch.input")
	assert.False(t, hasOutput, "output content should not be recorded under langwatch.output")

	// Structure + usage still recorded.
	assert.Equal(t, attribute.StringValue("anthropic.claude-3-haiku-20240307-v1:0"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.IntValue(12), attrs[semconv.GenAIUsageInputTokensKey])
}

func TestConverse_RoundTrip_HTTPError_RecordsErrorStatus(t *testing.T) {
	stub := &stubHTTPClient{
		status:      http.StatusBadRequest,
		body:        `{"message": "bad model"}`,
		contentType: "application/json",
	}
	provider, exporter := newTestProvider(t)

	cfg := aws.Config{Region: "us-east-1", Credentials: stubCredentials{}, HTTPClient: stub}
	// Disable retries so a single error response yields a single span.
	InstrumentConfig(&cfg, WithTracerProvider(provider))
	client := bedrockruntime.NewFromConfig(cfg, func(o *bedrockruntime.Options) {
		o.RetryMaxAttempts = 1
	})

	_, err := client.Converse(context.Background(), &bedrockruntime.ConverseInput{
		ModelId:  aws.String("bad.model"),
		Messages: []types.Message{{Role: types.ConversationRoleUser, Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "hi"}}}},
	})
	require.Error(t, err)

	span := requireSingleSpan(t, provider, exporter)
	assert.Equal(t, codes.Error, span.Status().Code)
	// Request attributes are still recorded on the error path.
	assert.Equal(t, attribute.StringValue("bad.model"), spanAttrs(span)[semconv.GenAIRequestModelKey])
}

// TestConverse_Mapping_RichContent unit-tests the attribute mapping directly with
// constructed Converse structs carrying multimodal + tool content.
func TestConverse_Mapping_RichContent(t *testing.T) {
	provider, exporter := newTestProvider(t)

	input := &bedrockruntime.ConverseInput{
		ModelId: aws.String("anthropic.claude-3-5-sonnet-20240620-v1:0"),
		Messages: []types.Message{
			{
				Role: types.ConversationRoleUser,
				Content: []types.ContentBlock{
					&types.ContentBlockMemberText{Value: "describe this"},
					&types.ContentBlockMemberImage{Value: types.ImageBlock{Format: types.ImageFormatPng}},
				},
			},
			{
				Role: types.ConversationRoleAssistant,
				Content: []types.ContentBlock{
					&types.ContentBlockMemberToolUse{Value: types.ToolUseBlock{
						Name:      aws.String("get_weather"),
						ToolUseId: aws.String("tool-1"),
						Input:     document.NewLazyDocument(map[string]any{"city": "NYC"}),
					}},
				},
			},
		},
		ToolConfig: &types.ToolConfiguration{
			Tools: []types.Tool{
				&types.ToolMemberToolSpec{Value: types.ToolSpecification{Name: aws.String("get_weather")}},
			},
		},
	}
	output := &bedrockruntime.ConverseOutput{
		StopReason: types.StopReasonToolUse,
		Usage:      &types.TokenUsage{InputTokens: aws.Int32(3), OutputTokens: aws.Int32(2), TotalTokens: aws.Int32(5)},
		Output: &types.ConverseOutputMemberMessage{Value: types.Message{
			Role:    types.ConversationRoleAssistant,
			Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "result"}},
		}},
	}

	startSpanWithHandler(t, converseHandler{}, input, output, langwatch.DataCaptureAll, provider)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Tools recorded.
	tools := attrs[attribute.Key("gen_ai.request.tools")].AsString()
	assert.Contains(t, tools, "get_weather")

	// Stop reason from tool use.
	assert.Equal(t, attribute.StringSliceValue([]string{"tool_use"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// Input messages (gen_ai-native): first user message has text + image parts;
	// second has a tool_call.
	inMsgs := genAIMessages(t, attrs[genAIInputKey].AsString())
	require.Len(t, inMsgs, 2)
	parts, ok := inMsgs[0].Content.([]any)
	require.True(t, ok, "expected multimodal content parts, got %T", inMsgs[0].Content)
	require.Len(t, parts, 2)

	// Tool-call message survives the round-trip through chat content.
	toolParts := inMsgs[1].Content.([]any)
	require.Len(t, toolParts, 1)
	toolPart := toolParts[0].(map[string]any)
	assert.Equal(t, "tool_call", toolPart["type"])
	assert.Equal(t, "get_weather", toolPart["toolName"])
	assert.Contains(t, toolPart["args"], "NYC")

	// Chat input is gen_ai-native, NOT under the langwatch.input envelope.
	_, hasLangWatchInput := attrs[inputKey]
	assert.False(t, hasLangWatchInput, "chat input must not be under langwatch.input")
}
