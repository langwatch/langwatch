package openai

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"go.opentelemetry.io/otel"
	sdktrace "go.opentelemetry.io/otel/sdk/trace"
	"go.opentelemetry.io/otel/sdk/trace/tracetest"
	"go.opentelemetry.io/otel/trace"

	langwatch "github.com/langwatch/langwatch/sdk-go"
)

// TestResponsesAPIRequestAttributes tests that Responses API specific request attributes are correctly extracted
func TestResponsesAPIRequestAttributes(t *testing.T) {
	// Create a mock span
	exporter := tracetest.NewInMemoryExporter()
	sp := sdktrace.NewSimpleSpanProcessor(exporter)
	provider := sdktrace.NewTracerProvider(sdktrace.WithSpanProcessor(sp))
	defer func() {
		_ = sp.Shutdown(context.Background())
		_ = exporter.Shutdown(context.Background())
	}()

	originalTracerProvider := otel.GetTracerProvider()
	otel.SetTracerProvider(provider)
	defer otel.SetTracerProvider(originalTracerProvider)

	tracer := langwatch.Tracer("test", trace.WithInstrumentationVersion("test"))
	_, span := tracer.Start(context.Background(), "test-span")

	// Create a realistic Responses API request body with only fields that actually exist
	reqBody := `{
		"model": "gpt-4o",
		"input": "What is the weather like?",
		"instructions": "You are a helpful assistant",
		"max_output_tokens": 100,
		"temperature": 0.7,
		"top_p": 0.9,
		"parallel_tool_calls": true,
		"metadata": {
			"session_id": "test-session",
			"user_id": "test-user"
		},
		"tools": [
			{
				"type": "function",
				"function": {
					"name": "get_weather",
					"description": "Get current weather"
				}
			}
		],
		"tool_choice": "auto"
	}`

	// Test with recordInput=true
	processor := NewRequestProcessor(true)
	isStreaming, err := processor.processResponsesRequest([]byte(reqBody), span)
	require.NoError(t, err)
	assert.False(t, isStreaming)

	// End the span to ensure it's exported
	span.End()

	// Verify attributes were set
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)

	attrs := make(map[string]interface{})
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.AsInterface()
	}

	// Check standard attributes that should be set by the typed processor
	assert.Equal(t, "gpt-4o", attrs["gen_ai.request.model"])
	assert.Equal(t, 0.7, attrs["gen_ai.request.temperature"])
	assert.Equal(t, 0.9, attrs["gen_ai.request.top_p"])

	// Check Responses API specific attributes that actually exist and get set
	assert.Equal(t, int64(100), attrs["gen_ai.request.max_output_tokens"])
	assert.Equal(t, true, attrs["gen_ai.request.parallel_tool_calls"])
	assert.Contains(t, attrs["gen_ai.request.metadata"].(string), "session_id")

	// Check that streaming attribute is set
	assert.Equal(t, false, attrs["langwatch.gen_ai.streaming"])

	// Note: tools and tool_choice aren't consistently parsed by the typed structs
	// when the JSON structure doesn't exactly match what the SDK expects
}
