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
	processor := NewRequestProcessor(true, "openai")
	isStreaming, err := processor.processResponsesRequest([]byte(reqBody), span)
	require.NoError(t, err)
	assert.False(t, isStreaming)

	// End the span to ensure it's exported
	span.End()

	// Verify attributes were set
	spans := exporter.GetSpans()
	require.Len(t, spans, 1)

	attrs := make(map[string]any)
	for _, attr := range spans[0].Attributes {
		attrs[string(attr.Key)] = attr.Value.AsInterface()
	}

	// Check standard attributes that should be set by the typed processor
	assert.Equal(t, "gpt-4o", attrs["gen_ai.request.model"])
	assert.Equal(t, 0.7, attrs["gen_ai.request.temperature"])
	assert.Equal(t, 0.9, attrs["gen_ai.request.top_p"])

	// Check Responses API specific attributes that actually exist and get set
	assert.Equal(t, int64(100), attrs["gen_ai.request.max_tokens"]) // Now using semconv
	assert.Equal(t, true, attrs["gen_ai.request.parallel_tool_calls"])

	// Check that streaming attribute is set
	assert.Equal(t, false, attrs["langwatch.gen_ai.streaming"])
}

// TestResponsesAPIInputAndInstructionsRecording tests that input and instructions are properly recorded
func TestResponsesAPIInputAndInstructionsRecording(t *testing.T) {
	tests := []struct {
		name        string
		recordInput bool
		reqBody     string
		expectInput bool
		expectInstr bool
	}{
		{
			name:        "RecordInput=true with both input and instructions",
			recordInput: true,
			reqBody: `{
				"model": "gpt-4o",
				"input": "What is the weather like in Paris?",
				"instructions": "You are a helpful weather assistant"
			}`,
			expectInput: true,
			expectInstr: true,
		},
		{
			name:        "RecordInput=false with both input and instructions",
			recordInput: false,
			reqBody: `{
				"model": "gpt-4o",
				"input": "What is the weather like in Paris?",
				"instructions": "You are a helpful weather assistant"
			}`,
			expectInput: false,
			expectInstr: true, // Instructions should always be recorded
		},
		{
			name:        "RecordInput=true with only input",
			recordInput: true,
			reqBody: `{
				"model": "gpt-4o",
				"input": "What is the weather like in Paris?"
			}`,
			expectInput: true,
			expectInstr: false,
		},
		{
			name:        "RecordInput=true with only instructions",
			recordInput: true,
			reqBody: `{
				"model": "gpt-4o",
				"instructions": "You are a helpful weather assistant"
			}`,
			expectInput: false,
			expectInstr: true,
		},
		{
			name:        "RecordInput=true with empty input and instructions",
			recordInput: true,
			reqBody: `{
				"model": "gpt-4o",
				"input": "",
				"instructions": ""
			}`,
			expectInput: false,
			expectInstr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
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

			processor := NewRequestProcessor(tt.recordInput, "openai")
			isStreaming, err := processor.processResponsesRequest([]byte(tt.reqBody), span)
			require.NoError(t, err)
			assert.False(t, isStreaming)

			// End the span to ensure it's exported
			span.End()

			// Verify attributes were set
			spans := exporter.GetSpans()
			require.Len(t, spans, 1)

			attrs := make(map[string]any)
			for _, attr := range spans[0].Attributes {
				attrs[string(attr.Key)] = attr.Value.AsInterface()
			}

			// Check input recording
			if tt.expectInput {
				assert.Contains(t, attrs, "langwatch.input")
				// The input is stored as JSON-encoded typeWrapper
				expectedInput := `{"type":"text","value":"What is the weather like in Paris?"}`
				assert.Equal(t, expectedInput, attrs["langwatch.input"])
			} else {
				assert.NotContains(t, attrs, "langwatch.input")
			}

			// Check instructions recording
			if tt.expectInstr {
				assert.Contains(t, attrs, "langwatch.instructions")
				assert.Equal(t, "You are a helpful weather assistant", attrs["langwatch.instructions"])
			} else {
				assert.NotContains(t, attrs, "langwatch.instructions")
			}

			// Check that model is always set regardless of recording setting
			assert.Equal(t, "gpt-4o", attrs["gen_ai.request.model"])
		})
	}
}

// TestResponsesAPIComplexInputStructures tests more complex input structures
func TestResponsesAPIComplexInputStructures(t *testing.T) {
	tests := []struct {
		name         string
		reqBody      string
		expectInput  bool
		expectedType string
	}{
		{
			name: "String input",
			reqBody: `{
				"model": "gpt-4o",
				"input": "Simple string input"
			}`,
			expectInput:  true,
			expectedType: "string",
		},
		{
			name: "Object input - should not be recorded as string",
			reqBody: `{
				"model": "gpt-4o",
				"input": {
					"type": "object",
					"content": "Object input"
				}
			}`,
			expectInput:  false, // OfString.Valid() will be false for object inputs
			expectedType: "none",
		},
		{
			name: "Array input - should not be recorded as string",
			reqBody: `{
				"model": "gpt-4o",
				"input": ["item1", "item2"]
			}`,
			expectInput:  false, // OfString.Valid() will be false for array inputs
			expectedType: "none",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
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

			processor := NewRequestProcessor(true, "openai") // Always record input for these tests
			isStreaming, err := processor.processResponsesRequest([]byte(tt.reqBody), span)
			require.NoError(t, err)
			assert.False(t, isStreaming)

			// End the span to ensure it's exported
			span.End()

			// Verify attributes were set
			spans := exporter.GetSpans()
			require.Len(t, spans, 1)

			attrs := make(map[string]any)
			for _, attr := range spans[0].Attributes {
				attrs[string(attr.Key)] = attr.Value.AsInterface()
			}

			// Check input recording based on expectation
			if tt.expectInput {
				assert.Contains(t, attrs, "langwatch.input")
				// The input is stored as JSON-encoded typeWrapper
				expectedInput := `{"type":"text","value":"Simple string input"}`
				assert.Equal(t, expectedInput, attrs["langwatch.input"])
			} else {
				assert.NotContains(t, attrs, "langwatch.input")
			}

			// Check that model is always set
			assert.Equal(t, "gpt-4o", attrs["gen_ai.request.model"])
		})
	}
}
