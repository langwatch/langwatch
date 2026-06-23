package bedrock

import (
	"context"
	"net/http"
	"strings"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

func TestInvokeModel_RoundTrip_Anthropic_ParsesUsage(t *testing.T) {
	const respBody = `{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"hi"}],"stop_reason":"end_turn","usage":{"input_tokens":15,"output_tokens":8}}`
	stub := &stubHTTPClient{status: http.StatusOK, body: respBody, contentType: "application/json"}
	provider, exporter := newTestProvider(t)

	cfg := aws.Config{Region: "us-east-1", Credentials: stubCredentials{}, HTTPClient: stub}
	InstrumentConfig(&cfg, WithTracerProvider(provider))
	client := bedrockruntime.NewFromConfig(cfg)

	_, err := client.InvokeModel(context.Background(), &bedrockruntime.InvokeModelInput{
		ModelId:     aws.String("anthropic.claude-3-5-sonnet-20240620-v1:0"),
		ContentType: aws.String("application/json"),
		Body:        []byte(`{"anthropic_version":"bedrock-2023-05-31","max_tokens":64,"messages":[{"role":"user","content":"hi"}]}`),
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, "chat.anthropic.claude-3-5-sonnet-20240620-v1:0", span.Name())
	assert.Equal(t, attribute.StringValue("anthropic.claude-3-5-sonnet-20240620-v1:0"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.IntValue(15), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(8), attrs[semconv.GenAIUsageOutputTokensKey])
	assert.Equal(t, attribute.IntValue(23), attrs[attribute.Key("gen_ai.usage.total_tokens")])
	assert.Equal(t, attribute.StringSliceValue([]string{"end_turn"}), attrs[semconv.GenAIResponseFinishReasonsKey])

	// Body content recorded (capture defaults to all).
	_, hasInput := attrs[inputKey]
	_, hasOutput := attrs[outputKey]
	assert.True(t, hasInput)
	assert.True(t, hasOutput)
}

func TestInvokeModel_Mapping_Titan_ParsesUsage(t *testing.T) {
	const titanBody = `{"inputTextTokenCount":9,"results":[{"tokenCount":21,"outputText":"answer","completionReason":"FINISH"}]}`

	usage, ok := parseInvokeModelUsage([]byte(titanBody))
	require.True(t, ok)
	require.NotNil(t, usage.inputTokens)
	require.NotNil(t, usage.outputTokens)
	assert.Equal(t, 9, *usage.inputTokens)
	assert.Equal(t, 21, *usage.outputTokens)

	assert.Equal(t, "FINISH", parseInvokeModelStopReason([]byte(titanBody)))

	gen := usage.genAIUsage()
	require.NotNil(t, gen.TotalTokens)
	assert.Equal(t, 30, *gen.TotalTokens)
}

// TestInvokeModel_Mapping_Anthropic_CacheTokensInTotal verifies the synthesized
// total includes cache-read and cache-creation tokens (real input tokens), so
// usage is not understated.
func TestInvokeModel_Mapping_Anthropic_CacheTokensInTotal(t *testing.T) {
	const body = `{"usage":{"input_tokens":10,"output_tokens":5,"cache_read_input_tokens":4,"cache_creation_input_tokens":6}}`

	usage, ok := parseInvokeModelUsage([]byte(body))
	require.True(t, ok)
	require.NotNil(t, usage.cacheReadTokens)
	require.NotNil(t, usage.cacheCreationTokens)
	assert.Equal(t, 4, *usage.cacheReadTokens)
	assert.Equal(t, 6, *usage.cacheCreationTokens)

	gen := usage.genAIUsage()
	require.NotNil(t, gen.TotalTokens)
	// 10 + 5 + 4 + 6 = 25 (not the cache-excluding 15).
	assert.Equal(t, 25, *gen.TotalTokens)
	// Cache tokens flow solely through gen_ai.usage.*: cache read ->
	// cached_input_tokens, cache write -> cache_creation.input_tokens.
	require.NotNil(t, gen.CachedInputTokens)
	require.NotNil(t, gen.CacheCreationInputTokens)
	assert.Equal(t, 4, *gen.CachedInputTokens)
	assert.Equal(t, 6, *gen.CacheCreationInputTokens)
}

// TestInvokeModel_LargeBody_SkipsContentKeepsUsage verifies an oversized request
// /response body (e.g. an embedded image blob) has its content skipped while the
// model id and usage are still recorded.
func TestInvokeModel_LargeBody_SkipsContentKeepsUsage(t *testing.T) {
	provider, exporter := newTestProvider(t)

	// A request body padded past the size guard with a base64-like blob.
	bigBlob := strings.Repeat("A", maxInvokeModelBodyBytes+1)
	input := &bedrockruntime.InvokeModelInput{
		ModelId: aws.String("anthropic.claude-3-5-sonnet-20240620-v1:0"),
		Body:    []byte(`{"image":"` + bigBlob + `"}`),
	}
	// An oversized response body that still carries parseable usage up front.
	output := &bedrockruntime.InvokeModelOutput{
		ContentType: aws.String("application/json"),
		Body:        []byte(`{"usage":{"input_tokens":3,"output_tokens":4},"blob":"` + bigBlob + `"}`),
	}

	startSpanWithHandler(t, invokeModelHandler{}, input, output, langwatch.DataCaptureAll, provider)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	// Content is skipped for both directions when over the guard.
	_, hasInput := attrs[inputKey]
	_, hasOutput := attrs[outputKey]
	assert.False(t, hasInput, "oversized request body content must be skipped")
	assert.False(t, hasOutput, "oversized response body content must be skipped")

	// Model + usage are recorded regardless of body size.
	assert.Equal(t, attribute.StringValue("anthropic.claude-3-5-sonnet-20240620-v1:0"), attrs[semconv.GenAIRequestModelKey])
	assert.Equal(t, attribute.IntValue(3), attrs[semconv.GenAIUsageInputTokensKey])
	assert.Equal(t, attribute.IntValue(4), attrs[semconv.GenAIUsageOutputTokensKey])
}

// TestInvokeModel_BodyAtGuardLimit_RecordsContent verifies a body at exactly the
// guard limit is still recorded (the guard is an upper bound, inclusive).
func TestInvokeModel_BodyAtGuardLimit_RecordsContent(t *testing.T) {
	provider, exporter := newTestProvider(t)

	// Construct a JSON body of exactly maxInvokeModelBodyBytes.
	prefix := `{"x":"`
	suffix := `"}`
	pad := maxInvokeModelBodyBytes - len(prefix) - len(suffix)
	body := []byte(prefix + strings.Repeat("a", pad) + suffix)
	require.Len(t, body, maxInvokeModelBodyBytes)

	input := &bedrockruntime.InvokeModelInput{ModelId: aws.String("m"), Body: body}
	output := &bedrockruntime.InvokeModelOutput{ContentType: aws.String("application/json"), Body: body}

	startSpanWithHandler(t, invokeModelHandler{}, input, output, langwatch.DataCaptureAll, provider)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	_, hasInput := attrs[inputKey]
	_, hasOutput := attrs[outputKey]
	assert.True(t, hasInput, "body at the guard limit is recorded")
	assert.True(t, hasOutput, "body at the guard limit is recorded")
}

func TestInvokeModel_Mapping_UnknownBody_RecordsModelOnly(t *testing.T) {
	provider, exporter := newTestProvider(t)

	input := &bedrockruntime.InvokeModelInput{
		ModelId: aws.String("cohere.command-r-v1:0"),
		Body:    []byte(`{"prompt":"hello","some_vendor_field":true}`),
	}
	output := &bedrockruntime.InvokeModelOutput{
		ContentType: aws.String("application/json"),
		Body:        []byte(`{"generations":[{"text":"hello back"}]}`),
	}

	startSpanWithHandler(t, invokeModelHandler{}, input, output, langwatch.DataCaptureAll, provider)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)

	assert.Equal(t, attribute.StringValue("cohere.command-r-v1:0"), attrs[semconv.GenAIRequestModelKey])
	// No usage could be parsed from the unknown shape.
	_, hasUsage := attrs[semconv.GenAIUsageInputTokensKey]
	assert.False(t, hasUsage, "unknown body shape should not fabricate usage")
	// But body content is still captured.
	_, hasOutput := attrs[outputKey]
	assert.True(t, hasOutput)
}

func TestInvokeModel_Mapping_CaptureNone_DropsBody(t *testing.T) {
	provider, exporter := newTestProvider(t)

	input := &bedrockruntime.InvokeModelInput{ModelId: aws.String("m"), Body: []byte(`{"prompt":"x"}`)}
	output := &bedrockruntime.InvokeModelOutput{
		ContentType: aws.String("application/json"),
		Body:        []byte(`{"usage":{"input_tokens":1,"output_tokens":1}}`),
	}

	startSpanWithHandler(t, invokeModelHandler{}, input, output, langwatch.DataCaptureNone, provider)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	_, hasInput := attrs[inputKey]
	_, hasOutput := attrs[outputKey]
	assert.False(t, hasInput)
	assert.False(t, hasOutput)
	// Usage is structure, recorded regardless of capture.
	assert.Equal(t, attribute.IntValue(1), attrs[semconv.GenAIUsageInputTokensKey])
}
