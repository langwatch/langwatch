package bedrock

import (
	"context"
	"net/http"
	"testing"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime"
	"github.com/aws/aws-sdk-go-v2/service/bedrockruntime/types"
	"github.com/aws/smithy-go/middleware"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel/attribute"
	semconv "go.opentelemetry.io/otel/semconv/v1.40.0"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

func TestNewConfig_Defaults(t *testing.T) {
	cfg := newConfig()
	assert.Equal(t, langwatch.DataCaptureAll, cfg.dataCapture)
	assert.Equal(t, semconv.GenAIProviderNameAWSBedrock, cfg.genAIProvider)
	assert.Nil(t, cfg.tracerProvider)
}

func TestNewConfig_AppliesOptions(t *testing.T) {
	custom := semconv.GenAIProviderNameAnthropic
	cfg := newConfig(
		WithDataCapture(langwatch.DataCaptureInput),
		WithGenAIProvider(custom),
	)
	assert.Equal(t, langwatch.DataCaptureInput, cfg.dataCapture)
	assert.Equal(t, custom, cfg.genAIProvider)
}

func TestInstrumentConfig_NilConfigIsSafe(t *testing.T) {
	assert.NotPanics(t, func() { InstrumentConfig(nil) })
}

func TestInstrumentConfig_AppendsAPIOption(t *testing.T) {
	cfg := aws.Config{}
	require.Empty(t, cfg.APIOptions)
	InstrumentConfig(&cfg)
	assert.Len(t, cfg.APIOptions, 1, "tracing middleware should be appended to APIOptions")
}

func TestWithTracing_AddsMiddlewareToStack(t *testing.T) {
	stack := middleware.NewStack("test", func() any { return nil })
	err := WithTracing()(stack)
	require.NoError(t, err)
	assert.Contains(t, stack.Initialize.List(), middlewareID)
}

// TestWithGenAIProvider_OverridesProviderAttribute proves the override flows all
// the way to the span attribute via a real round-trip.
func TestWithGenAIProvider_OverridesProviderAttribute(t *testing.T) {
	stub := &stubHTTPClient{status: http.StatusOK, body: converseRespBody}
	provider, exporter := newTestProvider(t)

	cfg := aws.Config{Region: "us-east-1", Credentials: stubCredentials{}, HTTPClient: stub}
	InstrumentConfig(&cfg,
		WithTracerProvider(provider),
		WithGenAIProvider(semconv.GenAIProviderNameAnthropic),
	)
	client := bedrockruntime.NewFromConfig(cfg)

	_, err := client.Converse(context.Background(), &bedrockruntime.ConverseInput{
		ModelId:  aws.String("anthropic.claude-3-haiku-20240307-v1:0"),
		Messages: []types.Message{{Role: types.ConversationRoleUser, Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "hi"}}}},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	attrs := spanAttrs(span)
	assert.Equal(t, attribute.StringValue("anthropic"), attrs[semconv.GenAIProviderNameKey])
	// Span name uses the configured provider prefix.
	assert.Equal(t, "chat.anthropic.claude-3-haiku-20240307-v1:0", span.Name())
}

// TestWithTracing_PerOperationOption exercises the per-operation hook form.
func TestWithTracing_PerOperationOption(t *testing.T) {
	stub := &stubHTTPClient{status: http.StatusOK, body: converseRespBody}
	provider, exporter := newTestProvider(t)

	cfg := aws.Config{Region: "us-east-1", Credentials: stubCredentials{}, HTTPClient: stub}
	client := bedrockruntime.NewFromConfig(cfg, func(o *bedrockruntime.Options) {
		o.APIOptions = append(o.APIOptions, WithTracing(WithTracerProvider(provider)))
	})

	_, err := client.Converse(context.Background(), &bedrockruntime.ConverseInput{
		ModelId:  aws.String("anthropic.claude-3-haiku-20240307-v1:0"),
		Messages: []types.Message{{Role: types.ConversationRoleUser, Content: []types.ContentBlock{&types.ContentBlockMemberText{Value: "hi"}}}},
	})
	require.NoError(t, err)

	span := requireSingleSpan(t, provider, exporter)
	assert.Equal(t, attribute.StringValue("aws.bedrock"), spanAttrs(span)[semconv.GenAIProviderNameKey])
}
